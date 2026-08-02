import {
  coalesceFrames,
  expandSemanticSteps,
  upgradeExecutionTrace,
} from "@traceframe/core";
import type {
  DebuggerAdapter,
  DebuggerLaunchRequest,
  DebuggerStatus,
  ExecutionTrace,
  RawTraceStep,
  TraceFrame,
  TraceStep,
  RunSpec,
} from "@traceframe/core";
import type {
  PythonWorkerRequest,
  PythonWorkerPhase,
  PythonWorkerResponse,
  PythonWorkerStatus,
} from "./workerProtocol";

export type RuntimeStatus = DebuggerStatus;

export interface PyodideDebuggerAdapterOptions {
  onStatus?(status: RuntimeStatus): void;
  workerFactory?(): Worker;
  snapshotBudget?: number;
  memoryLimitBytes?: number;
  maxFrames?: number;
  maxMemoryMB?: number;
  executionTimeoutMs?: number;
  visualizationTimeoutMs?: number;
  startupTimeoutMs?: number;
}

export type PythonExecutorOptions = PyodideDebuggerAdapterOptions;

export interface PythonExecutionLimits {
  maxFrames?: number;
  maxMemoryMB?: number;
  executionTimeoutMs?: number;
}

interface PendingRequest {
  resolve(trace: ExecutionTrace): void;
  reject(error: Error): void;
  source: string;
  runSpec: RunSpec;
  timeoutId: number;
  executionTimeoutMs: number;
  visualizationTimeoutMs: number;
}

function isStatusMessage(value: unknown): value is PythonWorkerStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as PythonWorkerStatus).type === "status"
  );
}

function isPhaseMessage(value: unknown): value is PythonWorkerPhase {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as PythonWorkerPhase).type === "phase"
  );
}

function indexSteps(
  steps: RawTraceStep[],
  frames: TraceFrame[],
): TraceStep[] {
  let frameCursor = -1;
  const latestFrameByScope = new Map<string, number>();
  return steps.map((step, index) => {
    while (
      frameCursor + 1 < frames.length &&
      (frames[frameCursor + 1].eventIndex ?? Number.POSITIVE_INFINITY) <= index
    ) {
      frameCursor += 1;
      latestFrameByScope.set(frames[frameCursor].scopeId, frameCursor);
    }
    return {
      ...step,
      index,
      frameIndex:
        latestFrameByScope.get(step.scopeId) ?? Math.max(0, frameCursor),
    };
  });
}

function functionPlaybackSteps(
  steps: TraceStep[],
  runSpec: RunSpec,
): TraceStep[] {
  if (
    runSpec.mode !== "function" ||
    steps[0]?.event !== "call" ||
    steps[0].depth !== 0
  ) {
    return steps;
  }
  return steps.slice(1);
}

function inheritPersistentBindings(
  frames: Parameters<typeof coalesceFrames>[0],
): Parameters<typeof coalesceFrames>[0] {
  let persistentBindings: TraceFrame["locals"] = {};
  return frames.map((frame) => {
    const nextBindings = Object.fromEntries(
      (frame.persistentBindings ?? []).flatMap((name) =>
        frame.locals[name] === undefined ? [] : [[name, frame.locals[name]]],
      ),
    );
    if (Object.keys(nextBindings).length > 0) {
      persistentBindings = { ...persistentBindings, ...nextBindings };
    }
    return Object.keys(persistentBindings).length > 0
      ? {
          ...frame,
          locals: { ...persistentBindings, ...frame.locals },
        }
      : frame;
  });
}

export class PyodideDebuggerAdapter implements DebuggerAdapter {
  readonly languageId = "python";
  private worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly statusListeners = new Set<(status: DebuggerStatus) => void>();
  private requestSequence = 0;
  private currentStatus: RuntimeStatus = "idle";
  private runtimeReady = false;
  private readonly options: PyodideDebuggerAdapterOptions;

  constructor(
    options:
      | PyodideDebuggerAdapterOptions
      | ((status: RuntimeStatus) => void) = {},
  ) {
    this.options =
      typeof options === "function" ? { onStatus: options } : options;
    if (this.options.onStatus) {
      this.statusListeners.add(this.options.onStatus);
    }
    this.worker = this.createWorker();
  }

  get status(): DebuggerStatus {
    return this.currentStatus;
  }

  execute(request: DebuggerLaunchRequest): Promise<ExecutionTrace> {
    const limits = request.limits;
    return this.executeRun(
      request.source,
      request.runSpec ?? { mode: "script" },
      limits?.snapshotBudget,
      limits?.executionTimeoutMs,
      limits?.visualizationTimeoutMs,
      limits?.memoryLimitBytes,
    );
  }

  subscribe(listener: (status: DebuggerStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  run(
    source: string,
    runSpec?: RunSpec,
    limits?: PythonExecutionLimits,
  ): Promise<ExecutionTrace>;
  run(
    source: string,
    runSpec?: RunSpec,
    maxFrames?: number,
    timeoutMs?: number,
    maxMemoryMB?: number,
  ): Promise<ExecutionTrace>;
  run(
    source: string,
    runSpec: RunSpec = { mode: "script" },
    limitsOrMaxFrames: PythonExecutionLimits | number = {},
    legacyTimeoutMs?: number,
    legacyMaxMemoryMB?: number,
  ): Promise<ExecutionTrace> {
    const limits =
      typeof limitsOrMaxFrames === "number"
        ? {
            maxFrames: limitsOrMaxFrames,
            executionTimeoutMs: legacyTimeoutMs,
            maxMemoryMB: legacyMaxMemoryMB,
          }
        : limitsOrMaxFrames;
    return this.executeRun(
      source,
      runSpec,
      limits.maxFrames,
      limits.executionTimeoutMs,
      undefined,
      limits.maxMemoryMB === undefined
        ? undefined
        : limits.maxMemoryMB * 1024 * 1024,
    );
  }

  private executeRun(
    source: string,
    runSpec: RunSpec,
    requestedSnapshotBudget?: number,
    requestedTimeoutMs?: number,
    requestedVisualizationTimeoutMs?: number,
    requestedMemoryBytes?: number,
  ): Promise<ExecutionTrace> {
    const snapshotBudget =
      requestedSnapshotBudget ??
      this.options.snapshotBudget ??
      this.options.maxFrames ??
      500;
    const timeoutMs =
      requestedTimeoutMs ?? this.options.executionTimeoutMs ?? 10_000;
    const visualizationTimeoutMs =
      requestedVisualizationTimeoutMs ??
      this.options.visualizationTimeoutMs ??
      30_000;
    const maxMemoryBytes =
      requestedMemoryBytes ??
      this.options.memoryLimitBytes ??
      (this.options.maxMemoryMB ?? 64) * 1024 * 1024;
    if (!Number.isInteger(snapshotBudget) || snapshotBudget <= 0) {
      return Promise.reject(
        new RangeError("Frame budget must be a positive integer"),
      );
    }
    if (!Number.isFinite(maxMemoryBytes) || maxMemoryBytes <= 0) {
      return Promise.reject(
        new RangeError("Memory limit must be a positive number of bytes"),
      );
    }
    const id = `run-${++this.requestSequence}`;
    const runtimeWasReady = this.runtimeReady;
    this.setStatus("running");

    return new Promise((resolve, reject) => {
      const timeoutId = this.createTimeout(
        id,
        runtimeWasReady ? timeoutMs : this.options.startupTimeoutMs ?? 90_000,
        runtimeWasReady
          ? `Execution exceeded the ${Math.round(timeoutMs / 1000)} second limit`
          : `Python runtime startup exceeded ${Math.round((this.options.startupTimeoutMs ?? 90_000) / 1000)} seconds`,
      );

      this.pending.set(id, {
        resolve,
        reject,
        source,
        runSpec,
        timeoutId,
        executionTimeoutMs: timeoutMs,
        visualizationTimeoutMs,
      });
      const request: PythonWorkerRequest = {
        id,
        source,
        runSpec,
        snapshotBudget,
        maxMemoryBytes: Math.floor(maxMemoryBytes),
      };
      this.worker.postMessage(request);
    });
  }

  dispose(): void {
    this.worker.terminate();
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeoutId);
      request.reject(new Error("Debugger adapter disposed"));
    }
    this.pending.clear();
  }

  private createWorker(): Worker {
    this.runtimeReady = false;
    const worker =
      this.options.workerFactory?.() ??
      new Worker(new URL("./python.worker.ts", import.meta.url), {
        type: "module",
        name: "traceframe-python",
      });
    worker.addEventListener("message", (event: MessageEvent<PythonWorkerResponse | PythonWorkerStatus | PythonWorkerPhase>) => {
      if (isStatusMessage(event.data)) {
        if (event.data.status === "ready") {
          this.runtimeReady = true;
          this.armExecutionTimeouts();
        }
        this.setStatus(event.data.status);
        return;
      }
      if (isPhaseMessage(event.data)) {
        this.armVisualizationTimeout(event.data.id);
        return;
      }
      this.handleResponse(event.data);
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "Python worker failed");
      for (const request of this.pending.values()) {
        window.clearTimeout(request.timeoutId);
        request.reject(error);
      }
      this.pending.clear();
      this.setStatus("idle");
    });
    return worker;
  }

  private armExecutionTimeouts(): void {
    for (const [id, request] of this.pending) {
      window.clearTimeout(request.timeoutId);
      request.timeoutId = this.createTimeout(
        id,
        request.executionTimeoutMs,
        `Execution exceeded the ${Math.round(request.executionTimeoutMs / 1000)} second limit`,
      );
    }
  }

  private armVisualizationTimeout(id: string): void {
    const request = this.pending.get(id);
    if (!request) {
      return;
    }
    window.clearTimeout(request.timeoutId);
    request.timeoutId = this.createTimeout(
      id,
      request.visualizationTimeoutMs,
      `Visualization exceeded the ${Math.round(request.visualizationTimeoutMs / 1000)} second debugger limit`,
    );
  }

  private createTimeout(id: string, timeoutMs: number, message: string): number {
    return window.setTimeout(() => {
      const request = this.pending.get(id);
      if (!request) {
        return;
      }
      this.pending.delete(id);
      this.worker.terminate();
      this.worker = this.createWorker();
      this.setStatus("idle");
      request.reject(new Error(message));
    }, timeoutMs);
  }

  private handleResponse(response: PythonWorkerResponse): void {
    const request = this.pending.get(response.id);
    if (!request) {
      return;
    }
    window.clearTimeout(request.timeoutId);
    this.pending.delete(response.id);
    this.setStatus("ready");

    if (!response.ok) {
      request.reject(new Error(response.error));
      return;
    }

    const frames = coalesceFrames(
      inheritPersistentBindings(response.trace.frames),
    );
    const steps = response.trace.steps
      ? expandSemanticSteps(
          functionPlaybackSteps(
            indexSteps(response.trace.steps, frames),
            request.runSpec,
          ),
        )
      : undefined;
    request.resolve(upgradeExecutionTrace({
      ...response.trace,
      irVersion: 2,
      source: request.source,
      runSpec: request.runSpec,
      frames,
      steps,
    }));
  }

  private setStatus(status: RuntimeStatus): void {
    this.currentStatus = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

export { PyodideDebuggerAdapter as PythonExecutor };
