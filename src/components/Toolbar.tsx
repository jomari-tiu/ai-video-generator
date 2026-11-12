import { useState } from "react";
import {
  Download,
  FilePlus2,
  FolderOpen,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useStore } from "@/store";
import { download, exportPdf } from "@/lib/export";
import { pickFile } from "@/lib/images";
import { TOOL_GROUPS, chooseTool } from "@/lib/tools";

export function Toolbar({ onSignature }: { onSignature: () => void }) {
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const fileName = useStore((s) => s.fileName);
  const [saving, setSaving] = useState(false);
  const s = useStore.getState;

  async function save() {
    setSaving(true);
    try {
      const { bytes, replacedChars, flattenedPages } = await exportPdf(s().pages);
      download(bytes, `${fileName || "document"}-edited.pdf`);
      const notes = [
        flattenedPages && `${flattenedPages} redacted page${flattenedPages > 1 ? "s were" : " was"} saved as an image so the hidden text is gone.`,
        replacedChars && `${replacedChars} character${replacedChars > 1 ? "s" : ""} outside the standard PDF fonts became "?".`,
      ].filter(Boolean);
      if (notes.length) s().setError(notes.join(" "));
    } catch (e) {
      s().setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="file-name" title={fileName ?? ""}>
          {fileName}
        </span>
      </div>

      <nav className="tools" aria-label="Tools">
        {TOOL_GROUPS.map((group, gi) => (
          <div className="tool-group" key={gi}>
            {group.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tool"
                aria-pressed={tool === t.id}
                title={`${t.label} (${t.key})`}
                onClick={() => chooseTool(t.id, onSignature)}
              >
                <t.icon size={18} strokeWidth={1.75} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="actions">
        <div className="tool-group">
          <button type="button" className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={() => s().undo()}>
            <Undo2 size={18} />
          </button>
          <button type="button" className="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={() => s().redo()}>
            <Redo2 size={18} />
          </button>
        </div>
        <div className="tool-group zoom">
          <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out (Ctrl -)" onClick={() => s().setZoom(zoom / 1.2)}>
            <ZoomOut size={18} />
          </button>
          <span className="num zoom-val" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in (Ctrl +)" onClick={() => s().setZoom(zoom * 1.2)}>
            <ZoomIn size={18} />
          </button>
        </div>
        <div className="tool-group">
          <button
            type="button"
            className="icon-btn"
            title="Open another PDF"
            aria-label="Open another PDF"
            onClick={async () => {
              const files = await pickFile("application/pdf,.pdf");
              if (files.length) s().openFiles(files, "replace");
            }}
          >
            <FolderOpen size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Add pages from another PDF"
            aria-label="Add pages from another PDF"
            onClick={async () => {
              const files = await pickFile("application/pdf,.pdf", true);
              if (files.length) s().openFiles(files, "append");
            }}
          >
            <FilePlus2 size={18} />
          </button>
        </div>
        <button type="button" className="btn primary" onClick={save} disabled={saving}>
          <Download size={17} />
          {saving ? "Saving…" : "Download"}
        </button>
      </div>
    </header>
  );
}
