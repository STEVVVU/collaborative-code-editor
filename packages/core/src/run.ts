import type {
  FunctionRunSpec,
  JsonValue,
  ProjectionContractsV1,
  RunSpec,
  Scalar,
  ScalarValue,
} from "./types";

const ENTRYPOINT_PATTERN = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const BINDING_PATTERN = /^[A-Za-z_]\w*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function validateScalarValue(value: unknown, message: string): asserts value is ScalarValue {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["kind", "type", "value"]) ||
    value.kind !== "scalar" ||
    typeof value.type !== "string" ||
    value.type.length === 0 ||
    !isScalar(value.value)
  ) {
    throw new Error(message);
  }
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function validateProjectionContracts(
  value: unknown,
): asserts value is ProjectionContractsV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["version", "declarations"]) ||
    value.version !== 1 ||
    !Array.isArray(value.declarations)
  ) {
    throw new Error("Projection contracts must use version 1 with declarations");
  }
  const declarationIds = new Set<string>();
  const targets = new Set<string>();
  const targetPaths: Array<{ root: string; segments: string[] }> = [];

  value.declarations.forEach((declaration) => {
    if (
      !isRecord(declaration) ||
      !hasOnlyKeys(declaration, ["id", "target", "configuration"]) ||
      typeof declaration.id !== "string" ||
      declaration.id.trim().length === 0
    ) {
      throw new Error("Projection contract declarations require unique non-empty ids");
    }
    if (declarationIds.has(declaration.id)) {
      throw new Error(`Duplicate projection contract id '${declaration.id}'`);
    }
    declarationIds.add(declaration.id);
    if (
      !isRecord(declaration.target) ||
      !hasOnlyKeys(declaration.target, ["root", "segments"]) ||
      !isRecord(declaration.target.root) ||
      !hasOnlyKeys(declaration.target.root, ["kind", "name"])
    ) {
      throw new Error(`Projection contract '${declaration.id}' has an invalid target`);
    }
    if (
      declaration.target.root.kind !== "binding" ||
      typeof declaration.target.root.name !== "string" ||
      !BINDING_PATTERN.test(declaration.target.root.name) ||
      !Array.isArray(declaration.target.segments)
    ) {
      throw new Error(`Projection contract '${declaration.id}' has an invalid binding target`);
    }
    const rootName = declaration.target.root.name;
    const segments = declaration.target.segments as unknown[];
    const keys = segments.map((segment): string => {
      if (!isRecord(segment) || typeof segment.kind !== "string") {
        throw new Error(`Projection contract '${declaration.id}' has an invalid target segment`);
      }
      if (segment.kind === "field") {
        if (
          !hasOnlyKeys(segment, ["kind", "name"]) ||
          typeof segment.name !== "string" ||
          segment.name.length === 0
        ) {
          throw new Error(`Projection contract '${declaration.id}' has an invalid field segment`);
        }
        return JSON.stringify(["field", segment.name]);
      }
      if (segment.kind === "index") {
        if (
          !hasOnlyKeys(segment, ["kind", "index"]) ||
          typeof segment.index !== "number" ||
          !Number.isSafeInteger(segment.index) ||
          segment.index < 0
        ) {
          throw new Error(`Projection contract '${declaration.id}' has an invalid index segment`);
        }
        return JSON.stringify(["index", segment.index]);
      }
      if (segment.kind === "mapKey") {
        if (!hasOnlyKeys(segment, ["kind", "key"])) {
          throw new Error(`Projection contract '${declaration.id}' has an invalid map key segment`);
        }
        validateScalarValue(segment.key, `Projection contract '${declaration.id}' has an invalid map key segment`);
        return JSON.stringify(["mapKey", segment.key.type, segment.key.value]);
      }
      throw new Error(`Projection contract '${declaration.id}' has an unknown target segment`);
    });
    if (
      !isRecord(declaration.configuration) ||
      !hasOnlyKeys(declaration.configuration, ["kind", "representation", "directed"]) ||
      declaration.configuration.kind !== "graph" ||
      declaration.configuration.representation !== "adjacency-list" ||
      typeof declaration.configuration.directed !== "boolean"
    ) {
      throw new Error(`Projection contract '${declaration.id}' has an invalid graph configuration`);
    }
    const target = JSON.stringify([rootName, keys]);
    if (targets.has(target)) {
      throw new Error(`Duplicate projection contract target '${target}'`);
    }
    const conflicts = targetPaths.some((existing) => {
      const commonLength = Math.min(keys.length, existing.segments.length);
      return (
        rootName === existing.root &&
        keys.slice(0, commonLength).every((key, index) => key === existing.segments[index]) &&
        keys.length !== existing.segments.length
      );
    });
    if (conflicts) {
      throw new Error(`Conflicting projection contract target '${target}'`);
    }
    targets.add(target);
    targetPaths.push({ root: rootName, segments: keys });
  });
}

function validateInputDescriptors(argumentsValue: unknown[]): void {
  const identities = new Set<string>();
  const references = new Set<string>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) {
      return;
    }

    const kind = value.$kind;
    if (kind === undefined) {
      Object.values(value).forEach(visit);
      return;
    }
    if (kind === "reference") {
      if (typeof value.id !== "string" || value.id.length === 0) {
        throw new Error("Reference inputs require a non-empty id");
      }
      references.add(value.id);
      return;
    }
    if (kind === "object") {
      if (typeof value.type !== "string" || !ENTRYPOINT_PATTERN.test(value.type)) {
        throw new Error("Object inputs require a valid dotted type path");
      }
      if (!isRecord(value.fields)) {
        throw new Error("Object inputs require a fields object");
      }
      if (value.id !== undefined) {
        if (typeof value.id !== "string" || value.id.length === 0) {
          throw new Error("Object input ids must be non-empty strings");
        }
        if (identities.has(value.id)) {
          throw new Error(`Duplicate input identity '${value.id}'`);
        }
        identities.add(value.id);
      }
      Object.values(value.fields).forEach(visit);
      return;
    }
    if (kind === "construct") {
      if (
        typeof value.callable !== "string" ||
        !ENTRYPOINT_PATTERN.test(value.callable)
      ) {
        throw new Error("Construct inputs require a valid dotted callable path");
      }
      if (value.arguments !== undefined && !Array.isArray(value.arguments)) {
        throw new Error("Construct input arguments must be an array");
      }
      if (
        value.keywordArguments !== undefined &&
        !isRecord(value.keywordArguments)
      ) {
        throw new Error("Construct input keywordArguments must be an object");
      }
      if (value.fields !== undefined && !isRecord(value.fields)) {
        throw new Error("Construct input fields must be an object");
      }
      (value.arguments ?? []).forEach(visit);
      Object.values(value.keywordArguments ?? {}).forEach(visit);
      Object.values(value.fields ?? {}).forEach(visit);
      return;
    }
    throw new Error(`Unknown tagged input kind '${String(kind)}'`);
  };

  argumentsValue.forEach(visit);
  for (const reference of references) {
    if (!identities.has(reference)) {
      throw new Error(`Unknown input reference '${reference}'`);
    }
  }
}

export function parseFunctionRunSpec(
  entrypoint: string,
  argumentsText: string,
  projectionContracts?: unknown,
): FunctionRunSpec {
  const normalizedEntrypoint = entrypoint.trim();
  if (!ENTRYPOINT_PATTERN.test(normalizedEntrypoint)) {
    throw new Error("Entry point must be an identifier or dotted callable path");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    throw new Error("Arguments must be valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Arguments must be a JSON array");
  }
  validateInputDescriptors(parsed);
  if (projectionContracts !== undefined) {
    validateProjectionContracts(projectionContracts);
  }

  return {
    mode: "function",
    entrypoint: normalizedEntrypoint,
    arguments: parsed as JsonValue[],
    projectionContracts: projectionContracts as ProjectionContractsV1 | undefined,
  };
}

export function runSpecArgumentsText(runSpec: RunSpec): string {
  return runSpec.mode === "function"
    ? JSON.stringify(runSpec.arguments)
    : "[]";
}
