import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useStore } from "./store";
import { Welcome } from "./components/Welcome";
import { Subtitles } from "./components/Subtitles";
import { ImageSplit } from "./components/ImageSplit";
import { SrtVideo } from "./components/SrtVideo";
import { ModeSwitch, type Mode } from "./components/ModeSwitch";
import { Toolbar } from "./components/Toolbar";
import { TOOL_GROUPS, chooseTool } from "./lib/tools";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { Inspector } from "./components/Inspector";
import { SignatureDialog } from "./components/SignatureDialog";

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export default function App() {
  const hasDoc = useStore((s) => s.pages.length > 0);
  const error = useStore((s) => s.error);
  const loading = useStore((s) => s.loading);
  const [signing, setSigning] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [mode, setMode] = useState<Mode>("pdf");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || !useStore.getState().pages.length) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        s.redo();
      } else if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        s.setZoom(s.zoom * 1.2);
      } else if (mod && k === "-") {
        e.preventDefault();
        s.setZoom(s.zoom / 1.2);
      } else if ((k === "delete" || k === "backspace") && s.selected) {
        e.preventDefault();
        s.removeItem(s.selected.pageId, s.selected.itemId);
      } else if (k === "escape") {
        s.select(null);
        s.setTool("select");
      } else if (!mod && !e.altKey) {
        const t = TOOL_GROUPS.flat().find((t) => t.key.toLowerCase() === k);
        if (t) chooseTool(t.id, () => setSigning(true));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => useStore.getState().setError(null), 9000);
    return () => clearTimeout(t);
  }, [error]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (useStore.getState().past.length) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  return (
    <>
      {hasDoc ? (
        <div
          className="app"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDropping(false);
            useStore.getState().openFiles(Array.from(e.dataTransfer.files), "append");
          }}
        >
          <Toolbar onSignature={() => setSigning(true)} />
          <Sidebar />
          <Workspace />
          <Inspector />
          {dropping && (
            <div className="drop-veil" aria-hidden="true">
              <p>Drop to add these pages at the end</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <ModeSwitch mode={mode} onChange={setMode} />
          {mode === "pdf" ? <Welcome /> : mode === "subtitles" ? <Subtitles /> : mode === "split" ? <ImageSplit /> : <SrtVideo />}
        </>
      )}

      <SignatureDialog open={signing} onClose={() => setSigning(false)} />

      {loading && hasDoc && (
        <div className="toast" role="status">
          Opening…
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => useStore.getState().setError(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
