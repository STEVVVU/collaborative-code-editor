import type {
  MappingValue,
  RuntimeLocation,
  SerializedValue,
} from "./types";

export function serializedIdentity(
  value: SerializedValue | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.kind === "reference") {
    return value.targetId;
  }
  return "id" in value ? value.id : undefined;
}

function scalarToken(value: SerializedValue): string {
  if (value.kind !== "scalar") {
    return serializedIdentity(value) ?? JSON.stringify(value);
  }
  return `${value.type}:${JSON.stringify(value.value)}`;
}

export function serializedValuesEqual(
  left: SerializedValue,
  right: SerializedValue,
): boolean {
  return scalarToken(left) === scalarToken(right);
}

export function mappingEntryId(
  mapping: MappingValue,
  index: number,
): string {
  return (
    mapping.entryIds?.[index] ??
    `${mapping.id}:entry:${scalarToken(mapping.entries[index]?.[0] ?? {
      kind: "scalar",
      type: "missing",
      value: null,
    })}`
  );
}

export function runtimeLocationId(location: RuntimeLocation): string {
  switch (location.kind) {
    case "binding":
      return `binding:${location.activationId}:${location.name}`;
    case "field":
      return `field:${location.objectId}:${location.name}`;
    case "index":
      return `index:${location.containerId}:${location.index}`;
    case "mapping-entry":
      return `mapping:${location.mappingId}:${location.entryId}:${location.part}`;
    case "set-member":
      return `set:${location.setId}:${location.memberId}`;
    case "identity":
      return `identity:${location.objectId}`;
    case "expression":
      return `expression:${location.activationId}:${location.expression}`;
  }
}

export function locationForContainerAccess(
  container: SerializedValue | undefined,
  key: SerializedValue | undefined,
  activationId: string,
  expression: string,
): RuntimeLocation {
  if (
    container?.kind === "sequence" &&
    key?.kind === "scalar" &&
    typeof key.value === "number" &&
    Number.isInteger(key.value)
  ) {
    const index = key.value < 0 ? container.items.length + key.value : key.value;
    if (index >= 0 && index < container.items.length) {
      return { kind: "index", containerId: container.id, index };
    }
  }
  if (container?.kind === "mapping" && key) {
    const index = container.entries.findIndex(([candidate]) =>
      serializedValuesEqual(candidate, key)
    );
    if (index >= 0) {
      return {
        kind: "mapping-entry",
        mappingId: container.id,
        entryId: mappingEntryId(container, index),
        part: "value",
      };
    }
  }
  return { kind: "expression", activationId, expression };
}

export function resolvePathLocation(
  path: string,
  activationId: string,
  locals: Record<string, SerializedValue>,
): RuntimeLocation {
  const root = /^([A-Za-z_]\w*)/.exec(path);
  if (!root) {
    return { kind: "expression", activationId, expression: path };
  }
  let current = locals[root[1]];
  let offset = root[0].length;
  let location: RuntimeLocation = {
    kind: "binding",
    activationId,
    name: root[1],
  };
  while (current && offset < path.length) {
    const rest = path.slice(offset);
    const field = /^\.([A-Za-z_]\w*)/.exec(rest);
    if (field && current.kind === "object") {
      location = {
        kind: "field",
        objectId: current.id,
        name: field[1],
      };
      current = current.fields[field[1]];
      offset += field[0].length;
      continue;
    }
    const index = /^\[(-?\d+)\]/.exec(rest);
    if (
      index &&
      (current.kind === "sequence" || current.kind === "set")
    ) {
      const rawIndex = Number(index[1]);
      const resolvedIndex =
        rawIndex < 0 ? current.items.length + rawIndex : rawIndex;
      if (current.kind === "set") {
        location = {
          kind: "set-member",
          setId: current.id,
          memberId:
            current.itemIds?.[resolvedIndex] ??
            `${current.id}:member:${scalarToken(current.items[resolvedIndex])}`,
        };
      } else {
        location = {
          kind: "index",
          containerId: current.id,
          index: resolvedIndex,
        };
      }
      current = current.items[resolvedIndex];
      offset += index[0].length;
      continue;
    }
    const mapping = /^\{(\d+)\}\.(key|value)/.exec(rest);
    if (mapping && current.kind === "mapping") {
      const entryIndex = Number(mapping[1]);
      const part = mapping[2] as "key" | "value";
      location = {
        kind: "mapping-entry",
        mappingId: current.id,
        entryId: mappingEntryId(current, entryIndex),
        part,
      };
      current = current.entries[entryIndex]?.[part === "key" ? 0 : 1];
      offset += mapping[0].length;
      continue;
    }
    return { kind: "expression", activationId, expression: path };
  }
  return location;
}

function literalKey(
  token: string,
  locals: Record<string, SerializedValue>,
): SerializedValue | undefined {
  const trimmed = token.trim();
  if (/^-?\d+$/.test(trimmed)) {
    return { kind: "scalar", type: "int", value: Number(trimmed) };
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return {
      kind: "scalar",
      type: "str",
      value: trimmed.slice(1, -1),
    };
  }
  return locals[trimmed]?.kind === "scalar" ? locals[trimmed] : undefined;
}

export function resolveExpressionLocation(
  expression: string,
  activationId: string,
  locals: Record<string, SerializedValue>,
): RuntimeLocation {
  const trimmed = expression.trim();
  const root = /^([A-Za-z_]\w*)/.exec(trimmed);
  if (!root || locals[root[1]] === undefined) {
    return { kind: "expression", activationId, expression: trimmed };
  }
  let current = locals[root[1]];
  let offset = root[0].length;
  let location: RuntimeLocation = {
    kind: "binding",
    activationId,
    name: root[1],
  };
  while (current && offset < trimmed.length) {
    const rest = trimmed.slice(offset);
    const field = /^\.([A-Za-z_]\w*)/.exec(rest);
    if (field && current.kind === "object") {
      location = {
        kind: "field",
        objectId: current.id,
        name: field[1],
      };
      current = current.fields[field[1]];
      offset += field[0].length;
      continue;
    }
    const subscript = /^\[([^\]]+)\]/.exec(rest);
    if (subscript) {
      const key = literalKey(subscript[1], locals);
      if (
        current.kind === "sequence" &&
        key?.kind === "scalar" &&
        typeof key.value === "number" &&
        Number.isInteger(key.value)
      ) {
        const index =
          key.value < 0 ? current.items.length + key.value : key.value;
        location = { kind: "index", containerId: current.id, index };
        current = current.items[index];
        offset += subscript[0].length;
        continue;
      }
      if (current.kind === "mapping" && key) {
        const index = current.entries.findIndex(([candidate]) =>
          serializedValuesEqual(candidate, key)
        );
        if (index >= 0) {
          location = {
            kind: "mapping-entry",
            mappingId: current.id,
            entryId: mappingEntryId(current, index),
            part: "value",
          };
          current = current.entries[index][1];
          offset += subscript[0].length;
          continue;
        }
      }
    }
    return { kind: "expression", activationId, expression: trimmed };
  }
  return location;
}

export function indexRuntimeLocationPaths(
  locals: Record<string, SerializedValue>,
  activationId: string,
): Map<string, string> {
  const paths = new Map<string, string>();
  const visited = new Set<string>();
  const visit = (
    value: SerializedValue,
    path: string,
    location: RuntimeLocation,
  ) => {
    paths.set(runtimeLocationId(location), path);
    const identity = serializedIdentity(value);
    if (identity) {
      paths.set(
        runtimeLocationId({ kind: "identity", objectId: identity }),
        path,
      );
    }
    if (identity && visited.has(identity)) {
      return;
    }
    if (identity) {
      visited.add(identity);
    }
    if (value.kind === "sequence") {
      value.items.forEach((item, index) =>
        visit(item, `${path}[${index}]`, {
          kind: "index",
          containerId: value.id,
          index,
        })
      );
    } else if (value.kind === "set") {
      value.items.forEach((item, index) =>
        visit(item, `${path}[${index}]`, {
          kind: "set-member",
          setId: value.id,
          memberId:
            value.itemIds?.[index] ??
            `${value.id}:member:${scalarToken(item)}`,
        })
      );
    } else if (value.kind === "mapping") {
      value.entries.forEach(([key, item], index) => {
        const entryId = mappingEntryId(value, index);
        visit(key, `${path}{${index}}.key`, {
          kind: "mapping-entry",
          mappingId: value.id,
          entryId,
          part: "key",
        });
        visit(item, `${path}{${index}}.value`, {
          kind: "mapping-entry",
          mappingId: value.id,
          entryId,
          part: "value",
        });
      });
    } else if (value.kind === "object") {
      Object.entries(value.fields).forEach(([name, field]) =>
        visit(field, `${path}.${name}`, {
          kind: "field",
          objectId: value.id,
          name,
        })
      );
    }
  };
  Object.entries(locals).forEach(([name, value]) =>
    visit(value, name, {
      kind: "binding",
      activationId,
      name,
    })
  );
  return paths;
}
