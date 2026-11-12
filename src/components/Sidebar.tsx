import { useState } from "react";
import { FilePlus, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import type { PageRef } from "@/types";
import { useStore } from "@/store";
import { usePageCanvas } from "@/lib/usePageCanvas";
import { ItemShape } from "./ItemShape";

const THUMB_W = 132;

function Thumb({ page, index, current }: { page: PageRef; index: number; current: boolean }) {
  const scale = THUMB_W / Math.max(page.width, page.height);
  const { canvasRef } = usePageCanvas(page, scale);
  const quarter = page.rotation % 180 !== 0;
  const w = (quarter ? page.height : page.width) * scale;
  const h = (quarter ? page.width : page.height) * scale;

  return (
    <button
      type="button"
      className={`thumb${current ? " current" : ""}`}
      onClick={() => useStore.getState().goToPage(page.id)}
      aria-label={`Go to page ${index + 1}`}
      aria-current={current}
    >
      <span className="thumb-frame" style={{ width: w, height: h }}>
        <span
          className="thumb-page"
          style={{
            width: page.width * scale,
            height: page.height * scale,
            transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`,
          }}
        >
          <canvas ref={canvasRef} style={{ width: page.width * scale, height: page.height * scale }} />
          <svg viewBox={`0 0 ${page.width} ${page.height}`} width={page.width * scale} height={page.height * scale}>
            {page.items.map((it) => (
              <ItemShape key={it.id} item={it} />
            ))}
          </svg>
        </span>
      </span>
      <span className="thumb-num">{index + 1}</span>
    </button>
  );
}

export function Sidebar() {
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const s = useStore.getState;

  return (
    <aside className="sidebar" aria-label="Pages">
      <header className="panel-head">
        <h2>Pages</h2>
        <span className="muted num">{pages.length}</span>
      </header>
      <ol className="thumbs">
        {pages.map((p, i) => (
          <li
            key={p.id}
            draggable
            className={`thumb-row${dragFrom === i ? " dragging" : ""}${dropAt === i && dragFrom !== null && dragFrom !== i ? (dragFrom < i ? " drop-after" : " drop-before") : ""}`}
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              setDropAt(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) s().movePage(dragFrom, i);
              setDragFrom(null);
              setDropAt(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDropAt(null);
            }}
          >
            <Thumb page={p} index={i} current={p.id === currentPageId} />
            <div className="thumb-actions" role="group" aria-label={`Page ${i + 1} actions`}>
              <button type="button" title="Rotate left" aria-label="Rotate left" onClick={() => s().rotatePage(p.id, -90)}>
                <RotateCcw size={15} />
              </button>
              <button type="button" title="Rotate right" aria-label="Rotate right" onClick={() => s().rotatePage(p.id, 90)}>
                <RotateCw size={15} />
              </button>
              <button type="button" title="Insert blank page after" aria-label="Insert blank page after" onClick={() => s().insertBlankAfter(p.id)}>
                <FilePlus size={15} />
              </button>
              <button
                type="button"
                className="danger"
                title="Delete page"
                aria-label="Delete page"
                onClick={() => s().deletePage(p.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <p className="sidebar-hint">Drag pages to reorder.</p>
    </aside>
  );
}
