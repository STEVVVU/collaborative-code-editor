export interface TopologyNode<T> {
  id: string;
  x: number;
  y: number;
  data: T;
}

export interface TopologyEdge<T> {
  id: string;
  sourceId: string;
  targetId: string;
  data: T;
}

export interface TopologySnapshot<NodeData, EdgeData> {
  width: number;
  height: number;
  nodes: TopologyNode<NodeData>[];
  edges: TopologyEdge<EdgeData>[];
}

export interface AnimatedTopologyNode<T> extends TopologyNode<T> {
  opacity: number;
  scale: number;
  phase: "entering" | "persisting" | "exiting";
}

export interface AnimatedTopologyEdge<T> extends TopologyEdge<T> {
  opacity: number;
  phase: "entering" | "persisting" | "exiting";
}

export interface AnimatedTopologyFrame<NodeData, EdgeData> {
  width: number;
  height: number;
  nodes: AnimatedTopologyNode<NodeData>[];
  edges: AnimatedTopologyEdge<EdgeData>[];
}

interface NodePose {
  x: number;
  y: number;
  opacity: number;
  scale: number;
}

interface NodeTransition<T> {
  id: string;
  data: T;
  phase: AnimatedTopologyNode<T>["phase"];
  from: NodePose;
  to: NodePose;
  arcX: number;
  arcY: number;
}

interface EdgeTransition<T> {
  id: string;
  sourceId: string;
  targetId: string;
  data: T;
  phase: AnimatedTopologyEdge<T>["phase"];
  fromOpacity: number;
  toOpacity: number;
}

export interface TopologyTransition<NodeData, EdgeData> {
  fromWidth: number;
  fromHeight: number;
  toWidth: number;
  toHeight: number;
  nodes: NodeTransition<NodeData>[];
  edges: EdgeTransition<EdgeData>[];
  changed: boolean;
}

export interface TopologyTransitionOptions {
  enterScale?: number;
  exitScale?: number;
  minNodeSeparation?: number;
}

const ENTER_SCALE = 0.72;
const EXIT_SCALE = 0.78;
const MIN_NODE_SEPARATION = 62;
const POSITION_EPSILON = 0.5;

function average(
  points: Array<{ x: number; y: number }>,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (points.length === 0) {
    return fallback;
  }
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function neighbors(
  nodeId: string,
  edges: Array<{ sourceId: string; targetId: string }>,
): string[] {
  return edges.flatMap((edge) => {
    if (edge.sourceId === nodeId) {
      return [edge.targetId];
    }
    if (edge.targetId === nodeId) {
      return [edge.sourceId];
    }
    return [];
  });
}

function poseChanged(left: NodePose, right: NodePose): boolean {
  return (
    Math.abs(left.x - right.x) > POSITION_EPSILON ||
    Math.abs(left.y - right.y) > POSITION_EPSILON ||
    Math.abs(left.opacity - right.opacity) > 0.01 ||
    Math.abs(left.scale - right.scale) > 0.01
  );
}

export function settledTopology<NodeData, EdgeData>(
  snapshot: TopologySnapshot<NodeData, EdgeData>,
): AnimatedTopologyFrame<NodeData, EdgeData> {
  return {
    width: snapshot.width,
    height: snapshot.height,
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      opacity: 1,
      scale: 1,
      phase: "persisting",
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      opacity: 1,
      phase: "persisting",
    })),
  };
}

export function compileTopologyTransition<NodeData, EdgeData>(
  previous: AnimatedTopologyFrame<NodeData, EdgeData>,
  next: TopologySnapshot<NodeData, EdgeData>,
  options: TopologyTransitionOptions = {},
): TopologyTransition<NodeData, EdgeData> {
  const enterScale = options.enterScale ?? ENTER_SCALE;
  const exitScale = options.exitScale ?? EXIT_SCALE;
  const minNodeSeparation =
    options.minNodeSeparation ?? MIN_NODE_SEPARATION;
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));
  const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
  const nextEdges = new Map(next.edges.map((edge) => [edge.id, edge]));

  const nodeTransitions: NodeTransition<NodeData>[] = next.nodes.map((node) => {
    const prior = previousNodes.get(node.id);
    if (prior) {
      return {
        id: node.id,
        data: node.data,
        phase: "persisting",
        arcX: 0,
        arcY: 0,
        from: {
          x: prior.x,
          y: prior.y,
          opacity: prior.opacity,
          scale: prior.scale,
        },
        to: { x: node.x, y: node.y, opacity: 1, scale: 1 },
      };
    }

    const connectedPreviousPositions = neighbors(node.id, next.edges)
      .map((id) => previousNodes.get(id))
      .filter((candidate) => candidate !== undefined);
    const origin = average(
      connectedPreviousPositions,
      node,
    );
    return {
      id: node.id,
      data: node.data,
      phase: "entering",
      arcX: 0,
      arcY: 0,
      from: { ...origin, opacity: 0, scale: enterScale },
      to: { x: node.x, y: node.y, opacity: 1, scale: 1 },
    };
  });

  previous.nodes.forEach((node) => {
    if (nextNodes.has(node.id)) {
      return;
    }
    const connectedTargets = neighbors(node.id, previous.edges)
      .map((id) => nextNodes.get(id))
      .filter((candidate) => candidate !== undefined);
    const destination = average(connectedTargets, node);
    nodeTransitions.push({
      id: node.id,
      data: node.data,
      phase: "exiting",
      arcX: 0,
      arcY: 0,
      from: {
        x: node.x,
        y: node.y,
        opacity: node.opacity,
        scale: node.scale,
      },
      to: {
        ...destination,
        opacity: 0,
        scale: exitScale,
      },
    });
  });

  const movingNodes = nodeTransitions.filter(
    (node) =>
      node.phase === "persisting" &&
      (
        Math.abs(node.from.x - node.to.x) > POSITION_EPSILON ||
        Math.abs(node.from.y - node.to.y) > POSITION_EPSILON
      ),
  );
  for (let leftIndex = 0; leftIndex < movingNodes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < movingNodes.length;
      rightIndex += 1
    ) {
      const left = movingNodes[leftIndex];
      const right = movingNodes[rightIndex];
      const leftMidpoint = {
        x: (left.from.x + left.to.x) / 2 + left.arcX,
        y: (left.from.y + left.to.y) / 2 + left.arcY,
      };
      const rightMidpoint = {
        x: (right.from.x + right.to.x) / 2 + right.arcX,
        y: (right.from.y + right.to.y) / 2 + right.arcY,
      };
      let differenceX = leftMidpoint.x - rightMidpoint.x;
      let differenceY = leftMidpoint.y - rightMidpoint.y;
      let distance = Math.hypot(differenceX, differenceY);
      if (distance >= minNodeSeparation) {
        continue;
      }
      if (distance < 0.001) {
        const movementX = left.to.x - left.from.x;
        const movementY = left.to.y - left.from.y;
        const movementLength = Math.max(1, Math.hypot(movementX, movementY));
        differenceX = -movementY / movementLength;
        differenceY = movementX / movementLength;
        distance = 1;
      }
      const push = (minNodeSeparation - distance) / 2 + 3;
      const normalX = differenceX / distance;
      const normalY = differenceY / distance;
      left.arcX += normalX * push;
      left.arcY += normalY * push;
      right.arcX -= normalX * push;
      right.arcY -= normalY * push;
    }
  }

  const edgeTransitions: EdgeTransition<EdgeData>[] = next.edges.map((edge) => {
    const prior = previousEdges.get(edge.id);
    return {
      ...edge,
      phase: prior ? "persisting" : "entering",
      fromOpacity: prior?.opacity ?? 0,
      toOpacity: 1,
    };
  });
  previous.edges.forEach((edge) => {
    if (nextEdges.has(edge.id)) {
      return;
    }
    edgeTransitions.push({
      ...edge,
      phase: "exiting",
      fromOpacity: edge.opacity,
      toOpacity: 0,
    });
  });

  const changed =
    Math.abs(previous.width - next.width) > POSITION_EPSILON ||
    Math.abs(previous.height - next.height) > POSITION_EPSILON ||
    nodeTransitions.some((node) =>
      node.phase !== "persisting" || poseChanged(node.from, node.to),
    ) ||
    edgeTransitions.some(
      (edge) =>
        edge.phase !== "persisting" ||
        Math.abs(edge.fromOpacity - edge.toOpacity) > 0.01,
    );

  return {
    fromWidth: previous.width,
    fromHeight: previous.height,
    toWidth: next.width,
    toHeight: next.height,
    nodes: nodeTransitions,
    edges: edgeTransitions,
    changed,
  };
}

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function enteringPresence(progress: number): number {
  return Math.min(1, Math.max(0, (progress - 0.15) / 0.7));
}

export function sampleTopologyTransition<NodeData, EdgeData>(
  transition: TopologyTransition<NodeData, EdgeData>,
  progress: number,
): AnimatedTopologyFrame<NodeData, EdgeData> {
  const clamped = Math.min(1, Math.max(0, progress));
  const complete = clamped === 1;
  return {
    width: complete
      ? transition.toWidth
      : Math.max(transition.fromWidth, transition.toWidth),
    height: complete
      ? transition.toHeight
      : Math.max(transition.fromHeight, transition.toHeight),
    nodes: transition.nodes
      .filter((node) => !complete || node.to.opacity > 0)
      .map((node) => {
        const presenceProgress =
          node.phase === "entering" ? enteringPresence(clamped) : clamped;
        return {
          id: node.id,
          data: node.data,
          phase: complete ? "persisting" : node.phase,
          x:
            interpolate(node.from.x, node.to.x, clamped) +
            Math.sin(Math.PI * clamped) * node.arcX,
          y:
            interpolate(node.from.y, node.to.y, clamped) +
            Math.sin(Math.PI * clamped) * node.arcY,
          opacity: interpolate(
            node.from.opacity,
            node.to.opacity,
            presenceProgress,
          ),
          scale: interpolate(
            node.from.scale,
            node.to.scale,
            presenceProgress,
          ),
        };
      }),
    edges: transition.edges
      .filter((edge) => !complete || edge.toOpacity > 0)
      .map((edge) => {
        const presenceProgress =
          edge.phase === "entering" ? enteringPresence(clamped) : clamped;
        return {
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          data: edge.data,
          phase: complete ? "persisting" : edge.phase,
          opacity: interpolate(
            edge.fromOpacity,
            edge.toOpacity,
            presenceProgress,
          ),
        };
      }),
  };
}
