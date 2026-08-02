import type {
  GraphProjection,
  GraphVertexProjection,
  RelationEntity,
  RelationGraph,
} from "./scene";

export interface PositionedGraphVertex {
  vertex: GraphVertexProjection;
  x: number;
  y: number;
}

export interface TopologyLayout {
  width: number;
  height: number;
  positioned: PositionedGraphVertex[];
}

export interface TopologyLayoutOptions {
  layerGap?: number;
  minHeight?: number;
  minWidth?: number;
  nodeGap?: number;
  nodeSize?: number;
  padding?: number;
}

export interface TopologyLayoutStrategy {
  id: string;
  matches(projection: GraphProjection): boolean;
  layout(
    projection: GraphProjection,
    options?: TopologyLayoutOptions,
  ): TopologyLayout;
}

const BASE_WIDTH = 520;
const BASE_HEIGHT = 200;

const treeStrategy: TopologyLayoutStrategy = {
  id: "layered-tree",
  matches: (projection) => projection.layout === "tree",
  layout: (projection, options = {}) => {
    const nodeSize = options.nodeSize ?? 48;
    const nodeGap = options.nodeGap ?? Math.max(28, nodeSize * 0.75);
    const padding = options.padding ?? nodeSize / 2 + 24;
    const layerGap =
      options.layerGap ?? Math.max(92, nodeSize + 44);
    const adjacency = new Map<string, string[]>();
    projection.edges.forEach((edge) => {
      adjacency.set(edge.sourceId, [
        ...(adjacency.get(edge.sourceId) ?? []),
        edge.targetId,
      ]);
      if (!projection.directed) {
        adjacency.set(edge.targetId, [
          ...(adjacency.get(edge.targetId) ?? []),
          edge.sourceId,
        ]);
      }
    });

    const depths = new Map<string, number>();
    const queue = projection.rootId
      ? [{ id: projection.rootId, depth: 0 }]
      : [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (depths.has(current.id)) {
        continue;
      }
      depths.set(current.id, current.depth);
      (adjacency.get(current.id) ?? []).forEach((id) => {
        if (!depths.has(id)) {
          queue.push({ id, depth: current.depth + 1 });
        }
      });
    }

    const layers = new Map<number, GraphVertexProjection[]>();
    projection.vertices.forEach((vertex) => {
      const depth = depths.get(vertex.id) ?? 0;
      layers.set(depth, [...(layers.get(depth) ?? []), vertex]);
    });
    const maxDepth = Math.max(0, ...layers.keys());
    const widestLayer = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
    const requiredWidth =
      padding * 2 +
      widestLayer * nodeSize +
      Math.max(0, widestLayer - 1) * nodeGap;
    const width = Math.max(options.minWidth ?? BASE_WIDTH, requiredWidth);
    const height = Math.max(
      options.minHeight ?? BASE_HEIGHT,
      padding * 2 + maxDepth * layerGap,
    );
    const positioned = [...layers.entries()].flatMap(([depth, layer]) =>
      layer.map((vertex, index) => ({
        vertex,
        x:
          layer.length === 1
            ? width / 2
            : padding + (index * (width - padding * 2)) / (layer.length - 1),
        y: padding + depth * layerGap,
      })),
    );
    return { width, height, positioned };
  },
};

const networkStrategy: TopologyLayoutStrategy = {
  id: "ring-network",
  matches: (projection) => projection.layout === "network",
  layout: (projection, options = {}) => {
    const count = projection.vertices.length;
    const nodeSize = options.nodeSize ?? 48;
    const nodeGap = options.nodeGap ?? Math.max(22, nodeSize * 0.45);
    const padding = options.padding ?? nodeSize / 2 + 28;
    const requiredSeparation = nodeSize + nodeGap;
    const radius = Math.max(
      66,
      count > 1
        ? requiredSeparation / (2 * Math.sin(Math.PI / count))
        : 0,
    );
    const diameter = radius * 2 + padding * 2;
    const width = Math.max(options.minWidth ?? BASE_WIDTH, diameter);
    const height = Math.max(options.minHeight ?? BASE_HEIGHT, diameter);

    return {
      width,
      height,
      positioned: projection.vertices.map((vertex, index) => {
        const angle =
          -Math.PI / 2 + (index * Math.PI * 2) / Math.max(1, count);
        return {
          vertex,
          x: count === 1 ? width / 2 : width / 2 + Math.cos(angle) * radius,
          y: count === 1 ? height / 2 : height / 2 + Math.sin(angle) * radius,
        };
      }),
    };
  },
};

export class TopologyLayoutRegistry {
  private readonly strategies: TopologyLayoutStrategy[];

  constructor(customStrategies: TopologyLayoutStrategy[] = []) {
    this.strategies = [
      ...customStrategies,
      treeStrategy,
      networkStrategy,
    ];
  }

  layout(
    projection: GraphProjection,
    options?: TopologyLayoutOptions,
  ): TopologyLayout {
    const strategy = this.strategies.find((candidate) =>
      candidate.matches(projection),
    );
    if (!strategy) {
      throw new Error(`No topology layout strategy for ${projection.layout}`);
    }
    return strategy.layout(projection, options);
  }
}

export const topologyLayoutRegistry = new TopologyLayoutRegistry();

export interface PositionedRelationEntity {
  entity: RelationEntity;
  x: number;
  y: number;
}

export interface RelationTopologyLayout {
  width: number;
  height: number;
  positioned: PositionedRelationEntity[];
}

export function layoutRelationGraph(
  graph: RelationGraph,
  options: TopologyLayoutOptions = {},
): RelationTopologyLayout {
  const nodeSize = options.nodeSize ?? 52;
  const nodeGap = options.nodeGap ?? 70;
  const padding = options.padding ?? nodeSize / 2 + 38;
  const minWidth = options.minWidth ?? 540;
  const minHeight = options.minHeight ?? 280;

  if (graph.layout === "network" || graph.layout === "cycle") {
    const count = graph.entities.length;
    const requiredSeparation = nodeSize + nodeGap * 0.45;
    const radius = Math.max(
      72,
      count > 1
        ? requiredSeparation / (2 * Math.sin(Math.PI / count))
        : 0,
    );
    const diameter = radius * 2 + padding * 2;
    const width = Math.max(minWidth, diameter);
    const height = Math.max(minHeight, diameter);
    return {
      width,
      height,
      positioned: graph.entities.map((entity, index) => {
        const angle =
          (graph.layout === "cycle" && count === 2 ? Math.PI : -Math.PI / 2) +
          (index * Math.PI * 2) / Math.max(1, graph.entities.length);
        return {
          entity,
          x: count === 1 ? width / 2 : width / 2 + Math.cos(angle) * radius,
          y: count === 1 ? height / 2 : height / 2 + Math.sin(angle) * radius,
        };
      }),
    };
  }

  const adjacency = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    adjacency.set(edge.sourceId, [
      ...(adjacency.get(edge.sourceId) ?? []),
      edge.targetId,
    ]);
  });
  const depths = new Map<string, number>();
  const pending = graph.roots.map((id) => ({ id, depth: 0 }));
  while (pending.length > 0) {
    const current = pending.shift()!;
    const previousDepth = depths.get(current.id);
    if (previousDepth !== undefined && previousDepth <= current.depth) {
      continue;
    }
    depths.set(current.id, current.depth);
    for (const target of adjacency.get(current.id) ?? []) {
      pending.push({ id: target, depth: current.depth + 1 });
    }
  }
  const fallbackDepth = Math.max(0, ...depths.values()) + 1;
  const layers = new Map<number, RelationEntity[]>();
  graph.entities.forEach((entity) => {
    const depth = depths.get(entity.id) ?? fallbackDepth;
    layers.set(depth, [...(layers.get(depth) ?? []), entity]);
  });
  const widestLayer = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
  const requiredWidth =
    padding * 2 +
    widestLayer * nodeSize +
    Math.max(0, widestLayer - 1) * nodeGap;
  const width = Math.max(minWidth, requiredWidth);
  const maxDepth = Math.max(0, ...layers.keys());
  const layerGap = options.layerGap ?? Math.max(108, nodeSize + 56);
  const height = Math.max(minHeight, padding * 2 + maxDepth * layerGap);
  const positioned = [...layers.entries()].flatMap(([depth, layer]) =>
    layer.map((entity, index) => ({
      entity,
      x:
        layer.length === 1
          ? width / 2
          : padding + (index * (width - padding * 2)) / (layer.length - 1),
      y: padding + depth * layerGap,
    })),
  );
  return { width, height, positioned };
}
