import { afterEach, describe, expect, it } from "vitest";
import type {
  PythonWorkerRequest,
  PythonWorkerPhase,
  PythonWorkerResponse,
} from "./workerProtocol";
import {
  PyodideDebuggerAdapter,
  PythonExecutor,
} from "./pyodideDebuggerAdapter";

class FakeWorker {
  readonly requests: PythonWorkerRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(request: PythonWorkerRequest) {
    this.requests.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  emit(
    data:
      | PythonWorkerResponse
      | PythonWorkerPhase
      | { type: "status"; status: "ready" },
  ) {
    this.listeners.get("message")?.forEach((listener) => {
      listener({ data } as MessageEvent);
    });
  }
}

const executors: PythonExecutor[] = [];

afterEach(() => {
  executors.splice(0).forEach((executor) => executor.dispose());
});

function createExecutor(
  worker: FakeWorker,
  maxMemoryMB?: number,
): PythonExecutor {
  const executor = new PythonExecutor({
    workerFactory: () => worker as unknown as Worker,
    maxMemoryMB,
  });
  executors.push(executor);
  worker.emit({ type: "status", status: "ready" });
  return executor;
}

function complete(worker: FakeWorker, id: string) {
  worker.emit({
    id,
    ok: true,
    trace: {
      frames: [],
      stdout: "",
      durationMs: 1,
    },
  });
}

describe("PythonExecutor memory limits", () => {
  it("implements the language-neutral debugger adapter contract", async () => {
    const worker = new FakeWorker();
    const adapter = new PyodideDebuggerAdapter({
      workerFactory: () => worker as unknown as Worker,
    });
    executors.push(adapter);
    worker.emit({ type: "status", status: "ready" });
    const statuses: string[] = [];
    adapter.subscribe((status) => statuses.push(status));
    const run = adapter.execute({
      source: "pass",
      runSpec: { mode: "script" },
      limits: {
        snapshotBudget: 250,
        executionTimeoutMs: 2_000,
        memoryLimitBytes: 3 * 1024 * 1024,
      },
    });

    expect(adapter.languageId).toBe("python");
    expect(worker.requests[0]).toMatchObject({
      snapshotBudget: 250,
      maxMemoryBytes: 3 * 1024 * 1024,
    });
    complete(worker, worker.requests[0].id);
    await run;
    expect(statuses).toEqual(["running", "ready"]);
  });

  it("preserves projection contracts in the worker request and trace", async () => {
    const worker = new FakeWorker();
    const executor = createExecutor(worker);
    const runSpec = {
      mode: "function" as const,
      entrypoint: "breadth_first_search",
      arguments: [[[1], [0]]],
      projectionContracts: {
        version: 1 as const,
        declarations: [
          {
            id: "bfs-graph",
            target: {
              root: { kind: "binding" as const, name: "graph" },
              segments: [],
            },
            configuration: {
              kind: "graph" as const,
              representation: "adjacency-list" as const,
              directed: true,
            },
          },
        ],
      },
    };
    const run = executor.run("pass", runSpec);

    expect(worker.requests[0].runSpec).toEqual(runSpec);
    complete(worker, worker.requests[0].id);
    await expect(run).resolves.toMatchObject({ runSpec });
  });

  it("sends the configured memory budget to the worker", async () => {
    const worker = new FakeWorker();
    const executor = createExecutor(worker, 12);
    const run = executor.run("pass");

    expect(worker.requests[0].maxMemoryBytes).toBe(12 * 1024 * 1024);
    complete(worker, worker.requests[0].id);
    await expect(run).resolves.toMatchObject({ frames: [] });
  });

  it("allows per-problem execution limits", async () => {
    const worker = new FakeWorker();
    const executor = createExecutor(worker);
    const run = executor.run("pass", { mode: "script" }, {
      maxFrames: 750,
      executionTimeoutMs: 2_000,
      maxMemoryMB: 2.5,
    });

    expect(worker.requests[0].snapshotBudget).toBe(750);
    expect(worker.requests[0].maxMemoryBytes).toBe(2.5 * 1024 * 1024);
    complete(worker, worker.requests[0].id);
    await run;
  });

  it("maps every debugger step to the latest retained state frame", async () => {
    const worker = new FakeWorker();
    const executor = createExecutor(worker);
    const run = executor.run("value = 1");
    const id = worker.requests[0].id;
    const rawFrame = (eventIndex: number) => ({
      eventIndex,
      event: "line" as const,
      source: { line: eventIndex + 1 },
      functionName: "<module>",
      scopeId: "module",
      depth: 0,
      locals: {},
      stdout: "",
    });
    const rawStep = (index: number) => ({
      event: "line" as const,
      source: { line: index + 1 },
      functionName: "<module>",
      scopeId: "module",
      depth: 0,
      callStack: [],
      semanticEvents: [],
    });
    worker.emit({
      id,
      ok: true,
      trace: {
        frames: [rawFrame(0), rawFrame(4)],
        steps: Array.from({ length: 6 }, (_, index) => rawStep(index)),
        stdout: "",
        durationMs: 1,
      },
    });

    await expect(run).resolves.toMatchObject({
      steps: [
        { index: 0, frameIndex: 0 },
        { index: 1, frameIndex: 0 },
        { index: 2, frameIndex: 0 },
        { index: 3, frameIndex: 0 },
        { index: 4, frameIndex: 1 },
        { index: 5, frameIndex: 1 },
      ],
    });
  });

  it("does not borrow visualization state from another debugger scope", async () => {
    const worker = new FakeWorker();
    const executor = createExecutor(worker);
    const run = executor.run("solve()");
    const id = worker.requests[0].id;
    worker.emit({
      id,
      ok: true,
      trace: {
        frames: [
          {
            eventIndex: 0,
            event: "call",
            source: { line: 1 },
            functionName: "solve",
            scopeId: "solve-frame",
            depth: 0,
            locals: {},
            stdout: "",
          },
          {
            eventIndex: 1,
            event: "call",
            source: { line: 4 },
            functionName: "<genexpr>",
            scopeId: "generator-frame",
            depth: 1,
            locals: {},
            stdout: "",
          },
        ],
        steps: [
          {
            event: "call",
            source: { line: 1 },
            functionName: "solve",
            scopeId: "solve-frame",
            depth: 0,
            callStack: [],
            semanticEvents: [],
          },
          {
            event: "call",
            source: { line: 4 },
            functionName: "<genexpr>",
            scopeId: "generator-frame",
            depth: 1,
            callStack: [],
            semanticEvents: [],
          },
          {
            event: "line",
            source: { line: 2 },
            functionName: "solve",
            scopeId: "solve-frame",
            depth: 0,
            callStack: [],
            semanticEvents: [],
          },
        ],
        stdout: "",
        durationMs: 1,
      },
    });

    await expect(run).resolves.toMatchObject({
      steps: [
        { frameIndex: 0 },
        { frameIndex: 1 },
        { frameIndex: 0 },
      ],
    });
  });

  it("rejects invalid memory budgets before posting work", async () => {
    const worker = new FakeWorker();
    const executor = createExecutor(worker);

    await expect(
      executor.run("pass", { mode: "script" }, { maxMemoryMB: 0 }),
    ).rejects.toThrow("positive number");
    expect(worker.requests).toHaveLength(0);
  });

  it("rejects invalid frame budgets before posting work", async () => {
    const worker = new FakeWorker();
    const executor = createExecutor(worker);

    await expect(
      executor.run("pass", { mode: "script" }, { maxFrames: 0 }),
    ).rejects.toThrow("positive integer");
    expect(worker.requests).toHaveLength(0);
  });
});
