import { useState } from "react";
import type { OnMount } from "@monaco-editor/react";
import type { NotebookClient, ConnectionState } from "./client";
import {
  addAnnotation,
  notebookTypes,
  readSettings,
  resolveAnnotation,
  shareUrl,
} from "./document";

type Editor = Parameters<OnMount>[0];
interface Props {
  client?: NotebookClient;
  state: ConnectionState;
  change: number;
  error?: string;
  viewToken?: string;
  editor: Editor | null;
  onCreate(title: string): void;
  onJoin(link: string): void;
  onLeave(): void;
}

export function NotebookPanel({
  client,
  state,
  error,
  viewToken,
  editor,
  onCreate,
  onJoin,
  onLeave,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("Debugging notebook");
  const [link, setLink] = useState("");
  const [author, setAuthor] = useState("Guest");
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState("");
  const canEdit = client && state.role === "edit";
  const labels = {
    connecting: "Connecting…",
    saved: "Saved to server",
    pending: "Saving…",
    offline: "Offline · local draft",
    error: "Sync needs attention",
  };

  const copy = async (token: string) => {
    if (!client) return;
    try {
      await navigator.clipboard.writeText(
        shareUrl({ id: client.capability.id, token }),
      );
      setFeedback("Link copied. Anyone with this link has its access level.");
    } catch {
      setFeedback(
        "Clipboard access failed. Allow clipboard access and try again.",
      );
    }
  };
  const annotate = () => {
    if (!canEdit || !editor) return;
    try {
      const model = editor.getModel();
      const selection = editor.getSelection();
      if (!model || !selection)
        throw new Error("Select code in the editor first.");
      addAnnotation(
        client.doc,
        model.getOffsetAt(selection.getStartPosition()),
        model.getOffsetAt(selection.getEndPosition()),
        text,
        author,
      );
      setText("");
      setFeedback("Comment attached to selected code.");
    } catch (failure) {
      setFeedback(
        failure instanceof Error ? failure.message : "Could not attach comment",
      );
    }
  };

  return (
    <section className="notebook" aria-label="Shared notebook">
      <div className="notebook-bar">
        <button
          type="button"
          className="notebook-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {client ? readSettings(client.doc).title : "Shared notebook"}
          <span>{expanded ? "−" : "+"}</span>
        </button>
        {client ? (
          <>
            <span
              role="status"
              className={`notebook-status notebook-${state.status}`}
            >
              {labels[state.status]} ·{" "}
              {state.role === "view"
                ? "View only"
                : state.role === "edit"
                  ? "Editor"
                  : "Authenticating"}{" "}
              · r{state.revision}
            </span>
            <span className="notebook-presence" aria-label="Online sessions">
              Online: {state.presence.length
                ? state.presence
                    .map(({ role }) => (role === "edit" ? "Editor" : "Viewer"))
                    .join(", ")
                : "none"}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => void copy(client.capability.token)}
              >
                Copy editor link
              </button>
            )}
            {viewToken && (
              <button type="button" onClick={() => void copy(viewToken)}>
                Copy viewer link
              </button>
            )}
            <button type="button" onClick={onLeave}>
              Leave notebook
            </button>
          </>
        ) : (
          <span className="notebook-hint">
            Co-edit code, keep drafts offline, discuss a selection.
          </span>
        )}
      </div>
      {(error || state.message) && (
        <p role="alert" className="notebook-error">
          {error || state.message}
        </p>
      )}
      {client && state.status === "error" && (
        <button type="button" onClick={() => client.reconnect()}>
          Reconnect notebook
        </button>
      )}
      {expanded && (
        <div className="notebook-detail">
          {!client ? (
            <div className="notebook-start">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onCreate(title);
                }}
              >
                <label>
                  Notebook title
                  <input
                    aria-label="Notebook title"
                    maxLength={120}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                  />
                </label>
                <button type="submit">Create notebook from this code</button>
              </form>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onJoin(link);
                  setLink("");
                }}
              >
                <label>
                  Notebook link
                  <input
                    aria-label="Notebook link"
                    type="password"
                    autoComplete="off"
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                    required
                  />
                </label>
                <button type="submit">Join notebook</button>
              </form>
            </div>
          ) : (
            <>
              <p className="notebook-hint">
                Code and run settings are shared. Execution stays in your
                browser and starts only when you press Run code.
              </p>
              {canEdit && (
                <div className="annotation-compose">
                  <label>
                    Name
                    <input
                      aria-label="Comment author"
                      maxLength={300}
                      value={author}
                      onChange={(event) => setAuthor(event.target.value)}
                    />
                  </label>
                  <label>
                    Comment on selected code
                    <textarea
                      aria-label="Code comment"
                      maxLength={2000}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                    />
                  </label>
                  <button type="button" onClick={annotate}>
                    Attach comment to selection
                  </button>
                </div>
              )}
              <ol className="annotation-list" aria-label="Code comments">
                {notebookTypes(client.doc)
                  .annotations.toArray()
                  .map((annotation) => {
                    const resolved = resolveAnnotation(client.doc, annotation);
                    return (
                      <li key={annotation.id}>
                        <div>
                          <strong>{annotation.author}</strong>
                          <span>
                            {!resolved
                              ? "Selected code deleted"
                              : resolved.current === annotation.quote
                                ? "Anchored to code"
                                : "Selected code changed"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="annotation-code"
                          disabled={!resolved}
                          onClick={() => {
                            const model = editor?.getModel();
                            if (!editor || !model || !resolved) return;
                            const start = model.getPositionAt(resolved.start);
                            const end = model.getPositionAt(resolved.end);
                            editor.setSelection({
                              startLineNumber: start.lineNumber,
                              startColumn: start.column,
                              endLineNumber: end.lineNumber,
                              endColumn: end.column,
                            });
                            editor.revealLineInCenter(start.lineNumber);
                            editor.focus();
                          }}
                        >
                          <code>{resolved?.current ?? annotation.quote}</code>
                        </button>
                        <p>{annotation.text}</p>
                        {resolved && resolved.current !== annotation.quote && (
                          <small>
                            Original: <code>{annotation.quote}</code>
                          </small>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              const annotations = notebookTypes(
                                client.doc,
                              ).annotations;
                              const index = annotations
                                .toArray()
                                .findIndex(
                                  (candidate) => candidate.id === annotation.id,
                                );
                              if (index >= 0) annotations.delete(index, 1);
                            }}
                          >
                            Remove comment
                          </button>
                        )}
                      </li>
                    );
                  })}
              </ol>
              {!notebookTypes(client.doc).annotations.length && (
                <p className="notebook-hint">
                  Select code in the editor, then attach a comment. Its anchor
                  follows edits.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {feedback && (
        <p role="status" className="notebook-feedback">
          {feedback}
        </p>
      )}
    </section>
  );
}
