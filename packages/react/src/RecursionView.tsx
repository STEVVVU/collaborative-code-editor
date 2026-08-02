import { ArrowRight } from "lucide-react";
import type {
  CallFlowProjection,
  CallFrameProjection,
  RecursionProjection,
  TopologySnapshot,
} from "@traceframe/core";
import { useMemo } from "react";
import { useTraceframeRendererConfig } from "./TraceframeProvider";
import { useTopologyMotion } from "./useTopologyMotion";

interface CallFlowViewProps {
  callFlow: CallFlowProjection;
}

export function CallFlowView({ callFlow }: CallFlowViewProps) {
  const rendererConfig = useTraceframeRendererConfig();
  const target = useMemo<TopologySnapshot<CallFrameProjection, null>>(
    () => {
      const gap = 112;
      const padding = 58;
      return {
        width: Math.max(520, padding * 2 + (callFlow.frames.length - 1) * gap),
        height: 176,
        nodes: callFlow.frames.map((frame, index) => ({
          id: frame.activationId,
          x: padding + index * gap,
          y: 82,
          data: frame,
        })),
        edges: callFlow.frames.slice(1).map((frame, index) => ({
          id: `${callFlow.frames[index].activationId}->${frame.activationId}`,
          sourceId: callFlow.frames[index].activationId,
          targetId: frame.activationId,
          data: null,
        })),
      };
    },
    [callFlow.frames],
  );
  const animated = useTopologyMotion(target, {
    durationMs: rendererConfig.motionDurationMs,
    minNodeSeparation: rendererConfig.minNodeSeparation,
  });
  const positions = new Map(animated.nodes.map((node) => [node.id, node]));
  const activeNodeId = [...animated.nodes]
    .reverse()
    .find((node) => node.phase !== "exiting")?.id;

  return (
    <section
      className="recursion-section tf-enter"
      aria-label={callFlow.recursive ? "Recursive evaluation" : "Call flow"}
    >
      <header>
        <strong>
          {callFlow.recursive ? "Recursive evaluation" : "Call flow"}
        </strong>
        <span>{callFlow.frames.length} active calls</span>
      </header>
      <div className="recursion-viewport">
        <div
          className="recursion-canvas"
          style={{ width: animated.width, height: animated.height }}
        >
          {animated.edges.map((edge) => {
            const source = positions.get(edge.sourceId);
            const targetNode = positions.get(edge.targetId);
            if (!source || !targetNode) {
              return null;
            }
            return (
              <ArrowRight
                aria-hidden="true"
                className="recursion-arrow"
                data-topology-phase={edge.phase}
                key={edge.id}
                opacity={edge.opacity}
                style={{
                  left: (source.x + targetNode.x) / 2 - 8,
                  top: source.y - 8,
                }}
              />
            );
          })}
          {animated.nodes.map((node, index) => {
            const frame = node.data;
            const active = node.id === activeNodeId;
            return (
              <div
                className={`recursion-call ${active ? "active" : ""}`}
                data-activation-id={frame.activationId}
                data-scope-id={frame.activationId}
                data-topology-phase={node.phase}
                key={node.id}
                style={{
                  left: node.x - 34,
                  opacity: node.opacity,
                  top: node.y - 34,
                  transform: `scale(${node.scale})`,
                }}
              >
                <small>{frame.functionName}</small>
                <strong>
                  {frame.bindings.map(({ value }) => value).join(", ") ||
                    `#${index + 1}`}
                </strong>
                <span>
                  {frame.bindings.map(({ name }) => name).join(", ") ||
                    `line ${frame.line}`}
                </span>
                {frame.returnValue !== undefined && (
                  <b className="recursion-return tf-enter">
                    return {frame.returnValue}
                  </b>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

interface RecursionViewProps {
  recursion: RecursionProjection;
}

/** @deprecated Use CallFlowView. */
export function RecursionView({ recursion }: RecursionViewProps) {
  return (
    <CallFlowView
      callFlow={{
        recursive: true,
        frames: recursion.frames.map((frame, index) => ({
          activationId: frame.scopeId,
          ...(index === 0
            ? {}
            : { parentActivationId: recursion.frames[index - 1].scopeId }),
          functionName: frame.functionName,
          line: frame.line,
          bindings: frame.bindings,
          ...(frame.returnValue === undefined
            ? {}
            : { returnValue: frame.returnValue }),
        })),
      }}
    />
  );
}
