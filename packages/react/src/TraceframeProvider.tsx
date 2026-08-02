import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type PropsWithChildren,
} from "react";
import {
  topologyLayoutRegistry,
  type TopologyLayoutRegistry,
} from "@traceframe/core";

export interface TraceframeRendererConfig {
  graphNodeSize: number;
  relationNodeSize: number;
  relationLayerGap: number;
  relationNodeGap: number;
  motionDurationMs: number;
  operationMotionDurationMs: number;
  stateTransitionMs: number;
  minNodeSeparation: number;
  topologyLayoutRegistry: TopologyLayoutRegistry;
}

export const defaultTraceframeRendererConfig: TraceframeRendererConfig = {
  graphNodeSize: 48,
  relationNodeSize: 52,
  relationLayerGap: 108,
  relationNodeGap: 70,
  motionDurationMs: 480,
  operationMotionDurationMs: 900,
  stateTransitionMs: 220,
  minNodeSeparation: 62,
  topologyLayoutRegistry,
};

const RendererContext = createContext(defaultTraceframeRendererConfig);

export interface TraceframeProviderProps extends PropsWithChildren {
  config?: Partial<TraceframeRendererConfig>;
}

export function TraceframeProvider({
  children,
  config,
}: TraceframeProviderProps) {
  const value = useMemo(
    () => ({ ...defaultTraceframeRendererConfig, ...config }),
    [config],
  );
  return (
    <RendererContext.Provider value={value}>
      {children}
    </RendererContext.Provider>
  );
}

export function useTraceframeRendererConfig(): TraceframeRendererConfig {
  return useContext(RendererContext);
}

export interface TraceframeSurfaceProps extends PropsWithChildren {
  className?: string;
  style?: CSSProperties;
}

export function TraceframeSurface({
  children,
  className = "",
  style,
}: TraceframeSurfaceProps) {
  const config = useTraceframeRendererConfig();
  return (
    <div
      className={`tf-root ${className}`.trim()}
      style={{
        "--tf-state-transition-duration": `${config.stateTransitionMs}ms`,
        ...style,
      } as CSSProperties}
    >
      {children}
    </div>
  );
}
