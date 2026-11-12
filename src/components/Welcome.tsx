import { useState } from "react";
import { FileText, Upload } from "lucide-react";
import { useStore } from "@/store";
import { pickFile } from "@/lib/images";

export function Welcome() {
  const loading = useStore((s) => s.loading);
  const [over, setOver] = useState(false);
  const s = useStore.getState;

  return (
    <main className="welcome">
      <div
        className={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          s().openFiles(Array.from(e.dataTransfer.files), "replace");
        }}
      >
        <div className="sheet" aria-hidden="true">
          <span />
          <span />
          <span className="mark" />
          <span />
        </div>
        <h1>Edit a PDF</h1>
        <p className="lede">Change text, sign, highlight, redact and rearrange pages. Then download the edited file.</p>
        <div className="welcome-actions">
          <button
            type="button"
            className="btn primary lg"
            disabled={loading}
            onClick={async () => {
              const files = await pickFile("application/pdf,.pdf", true);
              if (files.length) s().openFiles(files, "replace");
            }}
          >
            <Upload size={18} />
            {loading ? "Opening…" : "Choose PDF"}
          </button>
          <button type="button" className="btn ghost lg" onClick={() => s().newBlank()}>
            <FileText size={18} />
            Start with a blank page
          </button>
        </div>
        <p className="fine">Or drop PDFs here. Several files are merged in order. Your files stay on this computer; nothing is uploaded.</p>
      </div>
    </main>
  );
}
