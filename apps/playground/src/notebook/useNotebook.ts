import { useEffect, useRef, useState } from "react";
import { NotebookClient, type ConnectionState } from "./client";
import {
  notebookTypes,
  parseCapability,
  readSettings,
  type Capability,
  type NotebookSettings,
} from "./document";

function initialCapability(): Capability | null {
  const url = new URL(window.location.href);
  const shared = parseCapability(url);
  if (shared) {
    sessionStorage.setItem(`traceframe:${shared.id}`, JSON.stringify(shared));
    url.hash = "";
    url.searchParams.set("notebook", shared.id);
    window.history.replaceState(null, "", url);
    return shared;
  }
  const id = url.searchParams.get("notebook");
  const stored = id && sessionStorage.getItem(`traceframe:${id}`);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as Capability;
  } catch {
    return null;
  }
}

export function useNotebook(
  onChange: (source: string, settings: NotebookSettings) => void,
) {
  const [capability, setCapability] = useState(initialCapability);
  const [client, setClient] = useState<NotebookClient>();
  const [state, setState] = useState<ConnectionState>({
    status: "connecting",
    revision: 0,
  });
  const [change, setChange] = useState(0);
  const [error, setError] = useState<string>();
  const [viewToken, setViewToken] = useState<string | undefined>(() =>
    capability
      ? (sessionStorage.getItem(`traceframe:view:${capability.id}`) ??
        undefined)
      : undefined,
  );
  const callback = useRef(onChange);
  callback.current = onChange;
  const operation = useRef(0);
  const joinedInitially = useRef(Boolean(capability));

  useEffect(() => {
    if (!capability) {
      setClient(undefined);
      return;
    }
    const next = new NotebookClient(capability);
    setClient(next);
    setState(next.state);
    let previousContent = "";
    const update = () => {
      if (next.state.role) {
        const source = notebookTypes(next.doc).source.toString();
        const settings = readSettings(next.doc);
        const content = JSON.stringify([source, settings]);
        if (content !== previousContent) {
          previousContent = content;
          callback.current(source, settings);
        }
      }
      setChange((value) => value + 1);
    };
    const unsubscribe = next.subscribe(() => {
      setState({ ...next.state });
      update();
    });
    next.doc.on("update", update);
    void next.start();
    return () => {
      unsubscribe();
      next.doc.off("update", update);
      next.dispose();
    };
  }, [capability]);

  useEffect(
    () => () => {
      operation.current++;
    },
    [],
  );

  const open = (next: Capability, viewer?: string) => {
    operation.current++;
    setError(undefined);
    setViewToken(viewer);
    if (viewer) sessionStorage.setItem(`traceframe:view:${next.id}`, viewer);
    sessionStorage.setItem(`traceframe:${next.id}`, JSON.stringify(next));
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.set("notebook", next.id);
    window.history.replaceState(null, "", url);
    setCapability(next);
  };

  return {
    client,
    state,
    change,
    error,
    viewToken,
    joinedInitially: joinedInitially.current,
    async create(source: string, settings: NotebookSettings) {
      const request = ++operation.current;
      setError(undefined);
      try {
        const { title, ...configuration } = settings;
        const response = await fetch("/api/notebooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, source, settings: configuration }),
        });
        if (!response.ok)
          throw new Error(
            "Notebook creation failed. Check the local notebook server and try again.",
          );
        const room = await response.json();
        if (request !== operation.current) return;
        if (
          typeof room.id !== "string" ||
          typeof room.editToken !== "string" ||
          typeof room.viewToken !== "string"
        )
          throw new Error("Invalid server response");
        open({ id: room.id, token: room.editToken }, room.viewToken);
      } catch (failure) {
        if (request === operation.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "Notebook creation failed",
          );
      }
    },
    join(link: string) {
      try {
        const next = parseCapability(new URL(link));
        if (!next)
          throw new Error(
            "Paste a full Traceframe notebook link with its access key.",
          );
        open(next);
      } catch {
        setError("Paste a full Traceframe notebook link with its access key.");
      }
    },
    leave() {
      operation.current++;
      const url = new URL(window.location.href);
      url.hash = "";
      url.searchParams.delete("notebook");
      window.history.replaceState(null, "", url);
      setCapability(null);
      setViewToken(undefined);
    },
  };
}
