import Editor, { type OnMount } from "@monaco-editor/react";
import {
  Activity,
  AlertTriangle,
  Braces,
  ChevronDown,
  Code2,
  Download,
  FolderOpen,
  Play,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultTraceframeRendererConfig,
  PlaybackControls,
  Visualizer,
} from "@traceframe/react";
import { examples } from "./examples";
import { PyodideDebuggerAdapter } from "@traceframe/python";
import {
  compileScene,
  debuggerStepCount,
  debuggerStepForFrame,
  materializeDebuggerStep,
  materializeExecutionState,
  materializeExecutionTimeline,
  parseFunctionRunSpec,
  parseReplay,
  ProjectionRegistry,
  runSpecArgumentsText,
  serializeReplay,
  type DebuggerAdapter,
  type DebuggerStatus,
  type ExecutionTrace,
  type ProjectionContractsV1,
  type RunSpec,
} from "@traceframe/core";

const initialExample = examples[0];

function statusLabel(status: DebuggerStatus, running: boolean): string {
  if (running || status === "running") {
    return "Executing";
  }
  if (status === "loading") {
    return "Loading Python";
  }
  if (status === "ready") {
    return "Python ready";
  }
  return "Runtime idle";
}

export default function App() {
  const [source, setSource] = useState(initialExample.source);
  const [runMode, setRunMode] = useState<RunSpec["mode"]>(initialExample.runSpec.mode);
  const [entrypoint, setEntrypoint] = useState(
    initialExample.runSpec.mode === "function" ? initialExample.runSpec.entrypoint : "",
  );
  const [argumentsText, setArgumentsText] = useState(
    runSpecArgumentsText(initialExample.runSpec),
  );
  const [projectionContracts, setProjectionContracts] = useState(
    initialExample.runSpec.projectionContracts,
  );
  const [selectedExample, setSelectedExample] = useState(initialExample.id);
  const [trace, setTrace] = useState<ExecutionTrace>();
  const [frameIndex, setFrameIndex] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<DebuggerStatus>("idle");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const debuggerRef = useRef<DebuggerAdapter | null>(null);
  const replayInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const editorDisposablesRef = useRef<Array<{ dispose(): void }>>([]);
  const executionHighlightRef = useRef<HTMLDivElement | null>(null);
  const highlightAnimationRef = useRef<Animation | null>(null);
  const highlightFrameRef = useRef<number | null>(null);
  const activeLineRef = useRef<number | undefined>(undefined);

  const activeFrame = useMemo(
    () => materializeDebuggerStep(trace, frameIndex),
    [frameIndex, trace],
  );
  const playbackLength = debuggerStepCount(trace);
  activeLineRef.current = activeFrame?.source.line;
  const executionTimeline = useMemo(
    () => trace ? materializeExecutionTimeline(trace) : [],
    [trace],
  );
  const executionState =
    executionTimeline[frameIndex] ??
    (activeFrame ? materializeExecutionState(activeFrame) : undefined);
  const projectionRegistry = useMemo(
    () => {
      const registry = new ProjectionRegistry([], projectionContracts);
      trace?.frames.forEach((frame) => {
        registry.observeBindings(frame.locals);
        registry.observeRuntimeEvidence(
          [...(frame.activeVisualEvents ?? []), ...frame.semanticEvents],
          frame.locals,
        );
      });
      return registry;
    },
    [trace, projectionContracts],
  );
  const scene = useMemo(
    () => activeFrame
      ? compileScene(activeFrame, projectionRegistry, executionState)
      : undefined,
    [activeFrame, executionState, projectionRegistry],
  );
  const runtimeText = statusLabel(runtimeStatus, running);

  const positionExecutionHighlight = useCallback((
    line: number,
    animate: boolean,
    reveal: boolean,
  ) => {
    const editor = editorRef.current;
    const highlight = executionHighlightRef.current;
    if (!editor || !highlight) {
      return;
    }
    if (reveal) {
      editor.revealLineInCenterIfOutsideViewport(line);
    }
    if (highlightFrameRef.current !== null) {
      cancelAnimationFrame(highlightFrameRef.current);
    }
    highlightFrameRef.current = requestAnimationFrame(() => {
      highlightFrameRef.current = null;
      const layout = editor.getLayoutInfo();
      const top = editor.getTopForLineNumber(line) - editor.getScrollTop();
      const nextTransform = `translate3d(0, ${top}px, 0)`;
      highlight.dataset.sourceLine = String(line);
      highlight.style.setProperty(
        "--trace-content-left",
        `${layout.contentLeft}px`,
      );
      highlight.style.setProperty(
        "--trace-glyph-center",
        `${layout.glyphMarginLeft + layout.glyphMarginWidth / 2}px`,
      );

      const wasHidden = highlight.hidden;
      highlight.hidden = false;
      const reduceMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false;
      const currentTransform = getComputedStyle(highlight).transform;
      highlightAnimationRef.current?.cancel();
      highlightAnimationRef.current = null;

      if (
        !animate ||
        wasHidden ||
        reduceMotion ||
        currentTransform === nextTransform
      ) {
        highlight.style.transform = nextTransform;
        return;
      }

      const fromTransform =
        currentTransform === "none" ? nextTransform : currentTransform;
      highlight.style.transform = fromTransform;
      const animation = highlight.animate(
        [
          { transform: fromTransform },
          { transform: nextTransform },
        ],
        {
          duration: 260,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          fill: "forwards",
        },
      );
      highlightAnimationRef.current = animation;
      void animation.finished
        .then(() => {
          if (highlightAnimationRef.current !== animation) {
            return;
          }
          highlight.style.transform = nextTransform;
          highlightAnimationRef.current = null;
          animation.cancel();
        })
        .catch(() => undefined);
    });
  }, []);

  const execute = useCallback(async (code: string, runSpec: RunSpec) => {
    const adapter = debuggerRef.current;
    if (!adapter) {
      return;
    }
    setRunning(true);
    setPlaying(false);
    setError(undefined);
    try {
      const nextTrace = await adapter.execute({ source: code, runSpec });
      setTrace(nextTrace);
      const firstModuleState = nextTrace.frames.findIndex(
        (frame) =>
          frame.functionName === "<module>" &&
          Object.keys(frame.locals).length > 0,
      );
      const firstStateFrame = nextTrace.frames.findIndex(
        (frame) => Object.keys(frame.locals).length > 0,
      );
      const initialStateFrame = Math.max(
        0,
        firstModuleState >= 0 ? firstModuleState : firstStateFrame,
      );
      setFrameIndex(debuggerStepForFrame(nextTrace, initialStateFrame));
      if (nextTrace.error) {
        setError(nextTrace.error);
      }
    } catch (executionError) {
      setError(executionError instanceof Error ? executionError.message : String(executionError));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    const adapter = new PyodideDebuggerAdapter();
    const unsubscribe = adapter.subscribe(setRuntimeStatus);
    debuggerRef.current = adapter;
    void execute(initialExample.source, initialExample.runSpec);
    return () => {
      unsubscribe();
      adapter.dispose();
    };
  }, [execute]);

  useEffect(() => {
    if (!activeFrame) {
      if (executionHighlightRef.current) {
        executionHighlightRef.current.hidden = true;
      }
      return;
    }
    positionExecutionHighlight(activeFrame.source.line, true, true);
  }, [activeFrame, positionExecutionHighlight]);

  useEffect(() => () => {
    editorDisposablesRef.current.forEach((disposable) => disposable.dispose());
    highlightAnimationRef.current?.cancel();
    if (highlightFrameRef.current !== null) {
      cancelAnimationFrame(highlightFrameRef.current);
    }
    executionHighlightRef.current?.remove();
  }, []);

  useEffect(() => {
    if (!playing || !trace) {
      return;
    }
    if (frameIndex >= playbackLength - 1) {
      setPlaying(false);
      return;
    }
    const timeout = window.setTimeout(
      () => setFrameIndex((current) => Math.min(playbackLength - 1, current + 1)),
      scene?.operationMotion
        ? defaultTraceframeRendererConfig.operationMotionDurationMs * 1.85 / speed
        : 650 / speed,
    );
    return () => window.clearTimeout(timeout);
  }, [frameIndex, playbackLength, playing, scene?.operationMotion, speed, trace]);

  const handleEditorMount: OnMount = (editor, editorApi) => {
    editorRef.current = editor;
    const editorNode = editor.getDomNode();
    if (!editorNode) {
      return;
    }

    const highlight = document.createElement("div");
    highlight.className = "trace-execution-highlight";
    highlight.dataset.testid = "execution-line-highlight";
    highlight.hidden = true;
    highlight.setAttribute("aria-hidden", "true");
    highlight.style.height = `${editor.getOption(
      editorApi.editor.EditorOption.lineHeight,
    )}px`;
    const band = document.createElement("span");
    band.className = "trace-execution-band";
    const marker = document.createElement("span");
    marker.className = "trace-execution-marker";
    highlight.append(band, marker);
    editorNode.append(highlight);
    executionHighlightRef.current = highlight;

    editorDisposablesRef.current.forEach((disposable) => disposable.dispose());
    editorDisposablesRef.current = [
      editor.onDidScrollChange(() => {
        const line = activeLineRef.current;
        if (line !== undefined) {
          positionExecutionHighlight(line, false, false);
        }
      }),
      editor.onDidLayoutChange(() => {
        const line = activeLineRef.current;
        if (line !== undefined) {
          positionExecutionHighlight(line, false, false);
        }
      }),
    ];
    if (activeLineRef.current !== undefined) {
      positionExecutionHighlight(activeLineRef.current, false, true);
    }
  };

  const handleExampleChange = (exampleId: string) => {
    const example = examples.find((candidate) => candidate.id === exampleId);
    if (!example) {
      return;
    }
    setSelectedExample(example.id);
    setSource(example.source);
    setRunMode(example.runSpec.mode);
    setEntrypoint(example.runSpec.mode === "function" ? example.runSpec.entrypoint : "");
    setArgumentsText(runSpecArgumentsText(example.runSpec));
    setProjectionContracts(example.runSpec.projectionContracts);
    setTrace(undefined);
    setFrameIndex(0);
    setPlaying(false);
  };

  const handleSourceChange = (value: string) => {
    setSource(value);
    if (value !== source) {
      // Contracts target known example or replay bindings, not arbitrary edited source.
      setProjectionContracts(undefined);
    }
    const selectedSource = examples.find((example) => example.id === selectedExample)?.source;
    if (selectedSource !== undefined && selectedSource !== value) {
      setSelectedExample("custom");
    }
  };

  const markRunConfigurationCustom = () => {
    if (selectedExample !== "custom") {
      setSelectedExample("custom");
    }
  };

  const handleProjectionViewChange = useCallback((
    variableName: string,
    mode: "structural" | "graph",
    directed = false,
  ) => {
    const declarations = (projectionContracts?.declarations ?? []).filter(
      (declaration) => declaration.target.root.name !== variableName,
    );
    if (mode === "graph") {
      declarations.push({
        id: `interactive-view:${variableName}`,
        target: {
          root: { kind: "binding", name: variableName },
          segments: [],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed,
        },
      });
    }
    const nextContracts: ProjectionContractsV1 | undefined =
      declarations.length > 0
        ? { version: 1, declarations }
        : undefined;
    setProjectionContracts(nextContracts);
    setTrace((current) => current
      ? {
          ...current,
          runSpec: {
            ...current.runSpec,
            projectionContracts: nextContracts,
          },
        }
      : current
    );
  }, [projectionContracts]);

  const handleRun = () => {
    try {
      const runSpec: RunSpec =
        runMode === "function"
          ? parseFunctionRunSpec(
              entrypoint,
              argumentsText,
              projectionContracts,
            )
          : projectionContracts
            ? { mode: "script", projectionContracts }
            : { mode: "script" };
      void execute(source, runSpec);
    } catch (configurationError) {
      setError(
        configurationError instanceof Error
          ? configurationError.message
          : String(configurationError),
      );
    }
  };

  const handleDownloadReplay = () => {
    if (!trace) {
      return;
    }
    const blob = new Blob([serializeReplay(trace)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `traceframe-${timestamp}.traceframe.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleReplayFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const replay = parseReplay(await file.text());
      const restoredTrace = replay.trace;
      setSource(restoredTrace.source);
      setRunMode(restoredTrace.runSpec.mode);
      setEntrypoint(
        restoredTrace.runSpec.mode === "function"
          ? restoredTrace.runSpec.entrypoint
          : "",
      );
      setArgumentsText(runSpecArgumentsText(restoredTrace.runSpec));
      setProjectionContracts(restoredTrace.runSpec.projectionContracts);
      setSelectedExample("custom");
      setTrace(restoredTrace);
      setFrameIndex(0);
      setPlaying(false);
      setError(restoredTrace.error);
    } catch (replayError) {
      setError(
        replayError instanceof Error ? replayError.message : String(replayError),
      );
    } finally {
      if (replayInputRef.current) {
        replayInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Braces size={17} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <strong>Traceframe</strong>
          <span className="build-tag">alpha</span>
        </div>

        <div className="example-select-wrap">
          <Code2 size={14} aria-hidden="true" />
          <select
            onChange={(event) => handleExampleChange(event.target.value)}
            value={selectedExample}
            aria-label="Example program"
          >
            {selectedExample === "custom" && <option value="custom">Custom program</option>}
            {examples.map((example) => (
              <option key={example.id} value={example.id}>
                {example.name}
              </option>
            ))}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </div>

        <div className="header-actions">
          <span className={`runtime-status status-${runtimeStatus}`}>
            <i />
            {runtimeText}
          </span>
          <div className="replay-actions">
            <button
              className="header-icon-button"
              disabled={!trace}
              onClick={handleDownloadReplay}
              title="Save replay"
              aria-label="Save replay"
              type="button"
            >
              <Download size={15} aria-hidden="true" />
            </button>
            <button
              className="header-icon-button"
              onClick={() => replayInputRef.current?.click()}
              title="Open replay"
              aria-label="Open replay"
              type="button"
            >
              <FolderOpen size={15} aria-hidden="true" />
            </button>
            <input
              accept=".json,.traceframe.json,application/json"
              className="visually-hidden"
              onChange={(event) =>
                void handleReplayFile(event.target.files?.[0])
              }
              ref={replayInputRef}
              tabIndex={-1}
              type="file"
            />
          </div>
          <button
            className="run-button"
            disabled={running}
            onClick={handleRun}
            type="button"
          >
            {running ? <Activity size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            {running ? "Running" : "Run code"}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="editor-pane" aria-label="Python editor">
          <div className="pane-heading">
            <div>
              <span className="panel-kicker">SOURCE</span>
              <strong>main.py</strong>
            </div>
            <span className="language-badge">Python</span>
          </div>
          <div className="editor-wrap">
            <Editor
              beforeMount={(monaco) => {
                monaco.editor.defineTheme("traceframe-dark", {
                  base: "vs-dark",
                  inherit: true,
                  rules: [
                    { token: "comment", foreground: "6F8A77" },
                    { token: "keyword", foreground: "62B7E8" },
                    { token: "number", foreground: "E5B86A" },
                    { token: "string", foreground: "A7CF87" },
                  ],
                  colors: {
                    "editor.background": "#11161B",
                    "editor.lineHighlightBackground": "#1B232A",
                    "editorLineNumber.foreground": "#56616B",
                    "editorLineNumber.activeForeground": "#C7D0D7",
                    "editorIndentGuide.background1": "#263039",
                  },
                });
              }}
              language="python"
              onChange={(value) => handleSourceChange(value ?? "")}
              onMount={handleEditorMount}
              options={{
                fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
                fontSize: 13,
                glyphMargin: true,
                lineHeight: 21,
                minimap: { enabled: false },
                padding: { top: 12, bottom: 12 },
                renderLineHighlight: "none",
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                tabSize: 4,
                wordWrap: "off",
              }}
              theme="traceframe-dark"
              value={source}
            />
          </div>
          <div className="run-config">
            <div className="run-config-heading">
              <span className="panel-kicker">RUN</span>
              <div className="mode-control" role="group" aria-label="Execution mode">
                <button
                  className={runMode === "function" ? "active" : ""}
                  onClick={() => {
                    setRunMode("function");
                    markRunConfigurationCustom();
                  }}
                  type="button"
                >
                  Function
                </button>
                <button
                  className={runMode === "script" ? "active" : ""}
                  onClick={() => {
                    setRunMode("script");
                    markRunConfigurationCustom();
                  }}
                  type="button"
                >
                  Script
                </button>
              </div>
            </div>
            {runMode === "function" ? (
              <div className="run-fields">
                <label>
                  <span>ENTRY POINT</span>
                  <input
                    aria-label="Function entry point"
                    onChange={(event) => {
                      setEntrypoint(event.target.value);
                      markRunConfigurationCustom();
                    }}
                    spellCheck={false}
                    value={entrypoint}
                  />
                </label>
                <label className="arguments-field">
                  <span>ARGUMENTS JSON</span>
                  <textarea
                    aria-label="Function arguments JSON"
                    onChange={(event) => {
                      setArgumentsText(event.target.value);
                      markRunConfigurationCustom();
                    }}
                    spellCheck={false}
                    value={argumentsText}
                  />
                </label>
              </div>
            ) : (
              <code className="script-entrypoint">__main__</code>
            )}
          </div>
          <div className="console-panel">
            <div className="console-heading">
              <Terminal size={13} aria-hidden="true" />
              <span>Output</span>
            </div>
            <pre>{activeFrame?.stdout || (running ? "Executing..." : "")}</pre>
          </div>
        </section>

        <section className="visual-pane" aria-label="Execution visualization">
          <div className="pane-heading visual-heading">
            <div>
              <span className="panel-kicker">EXECUTION</span>
              <strong>{activeFrame ? activeFrame.functionName : "Waiting for trace"}</strong>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="visualizer-wrap">
            <Visualizer
              loading={running}
              onProjectionViewChange={handleProjectionViewChange}
              rendererConfig={{
                operationMotionDurationMs:
                  defaultTraceframeRendererConfig.operationMotionDurationMs /
                  speed,
              }}
              scene={scene}
              statusText={runtimeText}
            />
          </div>

          <PlaybackControls
            current={frameIndex}
            disabled={running}
            onCurrentChange={(index) => {
              setPlaying(false);
              setFrameIndex(index);
            }}
            onPlayingChange={setPlaying}
            onSpeedChange={setSpeed}
            playing={playing}
            speed={speed}
            total={playbackLength}
          />
        </section>
      </main>
    </div>
  );
}
