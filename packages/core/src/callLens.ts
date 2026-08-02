import type {
  ActivationState,
  ExecutionState,
} from "./executionModel";
import type { SerializedValue } from "./types";

export interface CallBindingProjection {
  name: string;
  value: string;
  kind?: SerializedValue["kind"];
}

export interface CallFrameProjection {
  activationId: string;
  parentActivationId?: string;
  functionName: string;
  line: number;
  bindings: CallBindingProjection[];
  returnValue?: string;
}

export interface CallFlowProjection {
  frames: CallFrameProjection[];
  recursive: boolean;
}

function scalarText(value: SerializedValue): string {
  if (value.kind !== "scalar") {
    return "";
  }
  if (value.value === null) {
    return "null";
  }
  return typeof value.value === "string"
    ? JSON.stringify(value.value)
    : String(value.value);
}

function valueSummary(value: SerializedValue): string {
  switch (value.kind) {
    case "scalar":
      return scalarText(value);
    case "sequence":
    case "set":
      return `${value.type}[${value.items.length}]`;
    case "mapping":
      return `${value.type}{${value.entries.length}}`;
    case "object": {
      const label = ["value", "val", "key", "name", "label"]
        .map((name) => value.fields[name])
        .find((field) => field?.kind === "scalar");
      return label === undefined
        ? value.type
        : `${value.type}(${scalarText(label)})`;
    }
    case "reference":
      return `ref ${value.type}`;
    case "truncated":
      return value.preview;
  }
}

function visibleBindings(activation: ActivationState) {
  const parameters = activation.bindings.filter(
    ({ location, parameter }) =>
      parameter && !["self", "cls"].includes(location.name),
  );
  const candidates = parameters.length > 0
    ? parameters
    : activation.bindings.filter(
        ({ location }) =>
          !["self", "cls", "$return"].includes(location.name) &&
          !location.name.endsWith(".memo"),
      );
  return candidates.slice(0, 2);
}

export function compileCallFlow(
  state: ExecutionState,
): CallFlowProjection | undefined {
  if (state.activations.length < 2) {
    return undefined;
  }
  const functionCounts = new Map<string, number>();
  state.activations.forEach(({ functionName }) => {
    functionCounts.set(
      functionName,
      (functionCounts.get(functionName) ?? 0) + 1,
    );
  });
  return {
    recursive: [...functionCounts.values()].some((count) => count > 1),
    frames: state.activations.map((activation) => ({
      activationId: activation.activationId,
      ...(activation.parentActivationId === undefined
        ? {}
        : { parentActivationId: activation.parentActivationId }),
      functionName: activation.functionName,
      line: activation.line,
      bindings: visibleBindings(activation).map((binding) => ({
        name: binding.location.name,
        value: valueSummary(binding.value),
        kind: binding.value.kind,
      })),
      ...(activation.returnValue === undefined
        ? {}
        : { returnValue: valueSummary(activation.returnValue) }),
    })),
  };
}
