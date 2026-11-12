import { useEffect, useRef, useState } from "react";
import type { BoxItem, InkItem, Item, LineItem, PageRef, TextItem } from "@/types";
import { useStore } from "@/store";
import { uid } from "@/lib/pdf";
import { usePageCanvas } from "@/lib/usePageCanvas";
import { extractLines, measureText, sampleColors, type TextLine, ASCENT, LEADING, CSS_FAMILY } from "@/lib/text";
import { HANDLES, bounds, moveItem, resizable, resizeItem, type Box, type Handle } from "@/lib/geometry";
import { ItemShape } from "./ItemShape";

type Drag =
  | { mode: "move"; item: Item; sx: number; sy: number; moved: boolean }
  | { mode: "resize"; item: Item; handle: Handle; start: Box; sx: number; sy: number; moved: boolean }
  | { mode: "draw"; id: string; sx: number; sy: number; kind: Item["kind"] };

/** Textarea baseline offset per family, so editing text sits where the drawn text sits. */
const EDIT_NUDGE: Record<TextItem["font"], number> = { Helvetica: -0.047, Times: -0.038, Courier: 0.034 };

export function PageView({ page, index }: { page: PageRef; index: number }) {
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const selected = useStore((s) => s.selected);
  const editingId = useStore((s) => s.editingId);
  const { canvasRef } = usePageCanvas(page, zoom);
  const slotRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [found, setFound] = useState<{ lines: TextLine[]; sideways: number } | null>(null);
  const lines = found?.lines;

  const quarter = page.rotation % 180 !== 0;
  const slotW = (quarter ? page.height : page.width) * zoom;
  const slotH = (quarter ? page.width : page.height) * zoom;

  // Editable text runs load only when the edit-text tool is in use.
  useEffect(() => {
    if (tool !== "edit-text" || !page.srcId || found) return;
    let live = true;
    extractLines(page.srcId, page.srcIndex).then((f) => live && setFound(f));
    return () => {
      live = false;
    };
  }, [tool, page.srcId, page.srcIndex, found]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = slotRef.current!.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / zoom;
    const dy = (e.clientY - (r.top + r.height / 2)) / zoom;
    const t = (-page.rotation * Math.PI) / 180;
    return {
      x: dx * Math.cos(t) - dy * Math.sin(t) + page.width / 2,
      y: dx * Math.sin(t) + dy * Math.cos(t) + page.height / 2,
    };
  };

  const st = () => useStore.getState();
  const findItem = (id: string) => st().pages.find((p) => p.id === page.id)?.items.find((i) => i.id === id);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest("textarea, .line-hit")) return;
    const { x, y } = toPage(e);
    const s = st();
    const style = s.style;
    const handle = target.closest("[data-handle]")?.getAttribute("data-handle") as Handle | null;
    const itemId = target.closest("[data-item]")?.getAttribute("data-item");

    if (editingId) s.setEditing(null);

    if (tool === "select" || tool === "edit-text") {
      if (handle && selected?.pageId === page.id) {
        const item = findItem(selected.itemId)!;
        drag.current = { mode: "resize", item, handle, start: bounds(item), sx: x, sy: y, moved: false };
      } else if (itemId) {
        const item = findItem(itemId)!;
        s.select({ pageId: page.id, itemId });
        drag.current = { mode: "move", item, sx: x, sy: y, moved: false };
      } else {
        s.select(null);
        return;
      }
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }

    const id = uid();
    let item: Item | null = null;
    switch (tool) {
      case "text": {
        const t: TextItem = {
          kind: "text",
          id,
          x,
          y: y - style.size * ASCENT * 0.7,
          text: "",
          font: style.font,
          size: style.size,
          bold: style.bold,
          italic: style.italic,
          color: style.textColor,
        };
        s.addItem(page.id, t, { select: true, edit: true });
        s.setTool("select");
        s.select({ pageId: page.id, itemId: id });
        s.setEditing(id);
        e.preventDefault();
        return;
      }
      case "rect":
      case "ellipse":
      case "whiteout":
      case "redact":
        item = {
          kind: tool,
          id,
          x,
          y,
          w: 0,
          h: 0,
          stroke: style.stroke,
          fill: tool === "rect" || tool === "ellipse" ? style.fill : null,
          strokeWidth: style.strokeWidth,
        } satisfies BoxItem;
        break;
      case "line":
        item = { kind: "line", id, x1: x, y1: y, x2: x, y2: y, stroke: style.stroke, strokeWidth: style.strokeWidth } satisfies LineItem;
        break;
      case "pen":
      case "highlight": {
        const hl = tool === "highlight";
        item = {
          kind: "ink",
          id,
          points: [[x, y]],
          stroke: hl ? style.highlightColor : style.penColor,
          strokeWidth: hl ? Math.max(10, style.penWidth * 6) : style.penWidth,
          opacity: hl ? 0.4 : 1,
          highlighter: hl,
        } satisfies InkItem;
        break;
      }
    }
    if (!item) return;
    s.addItem(page.id, item);
    drag.current = { mode: "draw", id, sx: x, sy: y, kind: item.kind };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const { x, y } = toPage(e);
    const s = st();
    if (d.mode === "draw") {
      const it = findItem(d.id);
      if (!it) return;
      if (it.kind === "ink") {
        const last = it.points[it.points.length - 1];
        if (Math.hypot(x - last[0], y - last[1]) * zoom < 1.5) return;
        s.patchItem(page.id, d.id, { points: [...it.points, [x, y]] });
      } else if (it.kind === "line") {
        s.patchItem(page.id, d.id, { x2: x, y2: y });
      } else {
        s.patchItem(page.id, d.id, { w: x - d.sx, h: y - d.sy });
      }
      return;
    }
    const dx = x - d.sx;
    const dy = y - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) * zoom < 3) return;
      d.moved = true;
      s.checkpoint();
    }
    if (d.mode === "move") s.patchItem(page.id, d.item.id, moveItem(d.item, dx, dy));
    else s.patchItem(page.id, d.item.id, resizeItem(d.item, d.start, d.handle, dx, dy, d.item));
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d || d.mode !== "draw") return;
    const s = st();
    const it = findItem(d.id);
    if (!it) return;
    if (it.kind === "ink") {
      if (it.points.length < 2) s.patchItem(page.id, it.id, { points: [...it.points, [it.points[0][0] + 0.5, it.points[0][1]]] });
      return; // pen and highlighter stay active for the next stroke
    }
    if (it.kind === "line") {
      if (Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 3) s.patchItem(page.id, it.id, { x2: it.x1 + 120 });
    } else if ("w" in it) {
      const tiny = Math.abs(it.w) < 3 && Math.abs(it.h) < 3;
      const b = tiny ? { x: it.x, y: it.y, w: it.kind === "redact" || it.kind === "whiteout" ? 140 : 120, h: tiny ? 40 : it.h } : it;
      s.patchItem(page.id, it.id, {
        x: Math.min(b.x, b.x + b.w),
        y: Math.min(b.y, b.y + b.h),
        w: Math.abs(b.w),
        h: Math.abs(b.h),
      });
    }
    if (it.kind === "whiteout" || it.kind === "redact") return;
    s.setTool("select");
    s.select({ pageId: page.id, itemId: it.id });
  }

  function onDoubleClick(e: React.MouseEvent) {
    const itemId = (e.target as Element).closest("[data-item]")?.getAttribute("data-item");
    const it = itemId && findItem(itemId);
    if (it && it.kind === "text") {
      st().checkpoint();
      st().select({ pageId: page.id, itemId: it.id });
      st().setEditing(it.id);
    }
  }

  /** Turn an existing run of PDF text into an editable item that covers the original. */
  function editLine(line: TextLine) {
    const s = st();
    const pad = line.size * 0.12;
    const cover = {
      x: line.x - pad,
      y: line.baseline - line.size * 0.95,
      w: line.width + pad * 2,
      h: line.size * 1.25,
      key: line.key,
    };
    const canvas = canvasRef.current!;
    const { ink, paper } = sampleColors(canvas, page.width, cover);
    const item: TextItem = {
      kind: "text",
      id: uid(),
      x: line.x,
      y: line.baseline - line.size * ASCENT,
      text: line.text,
      font: line.font,
      size: Math.round(line.size * 10) / 10,
      bold: line.bold,
      italic: line.italic,
      color: ink,
      cover: { ...cover, color: paper },
    };
    s.addItem(page.id, item, { select: true, edit: true });
  }

  const sel = selected?.pageId === page.id ? page.items.find((i) => i.id === selected.itemId) : undefined;
  const editing = editingId ? page.items.find((i) => i.id === editingId && i.kind === "text") as TextItem | undefined : undefined;
  const usedKeys = new Set(page.items.flatMap((i) => (i.kind === "text" && i.cover ? [i.cover.key] : [])));
  const hs = 8 / zoom;

  return (
    <div
      className="page-slot"
      ref={slotRef}
      style={{ width: slotW, height: slotH }}
      data-page-id={page.id}
      aria-label={`Page ${index + 1}`}
    >
      <div
        className={`page tool-${tool}`}
        style={{
          width: page.width * zoom,
          height: page.height * zoom,
          transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <canvas ref={canvasRef} style={{ width: page.width * zoom, height: page.height * zoom }} />
        <svg className="overlay" viewBox={`0 0 ${page.width} ${page.height}`} width={page.width * zoom} height={page.height * zoom}>
          {page.items.map((it) => (
            <ItemShape key={it.id} item={it} hidden={it.id === editingId} />
          ))}
          {sel && !editing && <Selection item={sel} hs={hs} zoom={zoom} />}
        </svg>

        {tool === "edit-text" &&
          lines?.map((l) =>
            usedKeys.has(l.key) ? null : (
              <button
                key={l.key}
                type="button"
                className="line-hit"
                title="Edit this text"
                style={{
                  left: (l.x - 2) * zoom,
                  top: (l.baseline - l.size * 0.95) * zoom,
                  width: (l.width + 4) * zoom,
                  height: l.size * 1.2 * zoom,
                }}
                onPointerDown={(e) => {
                  // Keep focus off this button so the text editor that replaces it can take it.
                  e.preventDefault();
                  e.stopPropagation();
                  editLine(l);
                }}
              />
            ),
          )}

        {editing && <TextEditor key={editing.id} item={editing} pageId={page.id} zoom={zoom} />}
      </div>

      {/* Outside the rotated layer so the note always reads upright. */}
      {tool === "edit-text" && page.srcId && found && found.lines.length === 0 && (
        <p className="page-note">
          {found.sideways
            ? "The text on this page is set sideways, so it can't be edited in place. Use Whiteout and Add text instead."
            : "No editable text on this page. It may be a scan; use Whiteout and Add text instead."}
        </p>
      )}
    </div>
  );
}

function Selection({ item, hs, zoom }: { item: Item; hs: number; zoom: number }) {
  const b = bounds(item);
  const pad = 3 / zoom;
  return (
    <g className="selection">
      <rect x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} fill="none" strokeWidth={1.5 / zoom} />
      {resizable(item) &&
        HANDLES.map((h) => {
          const cx = h.includes("w") ? b.x - pad : h.includes("e") ? b.x + b.w + pad : b.x + b.w / 2;
          const cy = h.includes("n") ? b.y - pad : h.includes("s") ? b.y + b.h + pad : b.y + b.h / 2;
          return (
            <rect
              key={h}
              data-handle={h}
              className={`handle h-${h}`}
              x={cx - hs / 2}
              y={cy - hs / 2}
              width={hs}
              height={hs}
              rx={1.5 / zoom}
              strokeWidth={1.5 / zoom}
            />
          );
        })}
    </g>
  );
}

function TextEditor({ item, pageId, zoom }: { item: TextItem; pageId: string; zoom: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { w, lines } = measureText(item);

  useEffect(() => {
    // Wait a frame: the pointer event that opened the editor is still settling focus.
    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = () => {
    const s = useStore.getState();
    const current = s.pages.find((p) => p.id === pageId)?.items.find((i) => i.id === item.id) as TextItem | undefined;
    if (current && !current.text.trim() && !current.cover) s.removeItem(pageId, item.id);
    else s.setEditing(null);
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={item.text}
      wrap="off"
      spellCheck
      rows={lines.length}
      aria-label="Text"
      style={{
        left: item.x * zoom,
        top: item.y * zoom,
        width: (w + item.size) * zoom,
        font: `${item.italic ? "italic " : ""}${item.bold ? 700 : 400} ${item.size * zoom}px/${LEADING} ${CSS_FAMILY[item.font]}`,
        marginTop: `${EDIT_NUDGE[item.font]}em`,
        color: item.color,
        background: item.cover ? item.cover.color : "transparent",
      }}
      onChange={(e) => useStore.getState().patchItem(pageId, item.id, { text: e.target.value })}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
