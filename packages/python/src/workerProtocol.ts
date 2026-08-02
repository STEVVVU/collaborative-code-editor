import type {
  ExecutionTrace,
  RawTraceFrame,
  RawTraceStep,
  RunSpec,
} from "@traceframe/core";

export interface PythonWorkerRequest {
  id: string;
  source: string;
  runSpec: RunSpec;
  snapshotBudget: number;
  maxMemoryBytes: number;
}

export interface PythonWorkerSuccess {
  id: string;
  ok: true;
  trace: Omit<
    ExecutionTrace,
    "source" | "runSpec" | "frames" | "steps"
  > & {
    frames: RawTraceFrame[];
    steps?: RawTraceStep[];
  };
}

export interface PythonWorkerFailure {
  id: string;
  ok: false;
  error: string;
}

export interface PythonWorkerStatus {
  type: "status";
  status: "loading" | "ready";
}

export interface PythonWorkerPhase {
  type: "phase";
  id: string;
  phase: "tracing";
}

export type PythonWorkerResponse =
  | PythonWorkerSuccess
  | PythonWorkerFailure;
