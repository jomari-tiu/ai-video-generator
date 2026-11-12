import { Bold, Italic, Trash2 } from "lucide-react";
import type { FontFamily, Item, Tool } from "@/types";
import { useStore } from "@/store";

const SWATCHES = ["#1b1d22", "#d92d20", "#1f5fd1", "#11845b", "#e5482d", "#7a4cc2"];
const HIGHLIGHTS = ["#ffd43b", "#8ce99a", "#74c0fc", "#ffa8a8", "#ffc078"];

const HINTS: Record<Tool, string> = {
  select: "Click anything you've added to select it. Drag to move, use the corner handles to resize, double-click text to edit it.",
  "edit-text": "Click any line of text in the PDF to change it. Clear it to delete the line.",
  text: "Click on the page where the text should start, then type.",
  image: "Choose a PNG, JPEG or other image; it lands in the middle of the page in view.",
  signature: "Draw your signature, then place and resize it.",
  rect: "Drag on the page to draw a rectangle.",
  ellipse: "Drag on the page to draw an ellipse.",
  line: "Drag on the page to draw a line.",
  pen: "Draw freehand on the page.",
  highlight: "Drag over text to highlight it.",
  whiteout: "Drag over anything to cover it in white.",
  redact: "Drag over sensitive content. On download, the page is saved as an image so the text underneath is truly removed.",
};

const NAMES: Record<Item["kind"], string> = {
  text: "Text",
  rect: "Rectangle",
  ellipse: "Ellipse",
  whiteout: "Whiteout",
  redact: "Redaction",
  line: "Line",
  ink: "Drawing",
  image: "Image",
};

function Colors({ value, onChange, palette = SWATCHES, label }: { value: string; onChange: (c: string) => void; palette?: string[]; label: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {palette.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === c}
            aria-label={c}
            className="swatch"
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
        <label className="swatch custom" title="Custom colour">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Custom ${label.toLowerCase()}`} />
        </label>
      </div>
    </div>
  );
}

function Num({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return (
    <label className="field row">
      <span className="field-label">{label}</span>
      <input
        type="number"
        className="num-input num"
        value={Math.round(value * 10) / 10}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
      />
    </label>
  );
}

type TextProps = { font: FontFamily; size: number; bold: boolean; italic: boolean; color: string };

function TextFields({ v, set }: { v: TextProps; set: (p: Partial<TextProps>) => void }) {
  return (
    <>
      <label className="field">
        <span className="field-label">Font</span>
        <select value={v.font} onChange={(e) => set({ font: e.target.value as FontFamily })}>
          <option value="Helvetica">Helvetica (sans)</option>
          <option value="Times">Times (serif)</option>
          <option value="Courier">Courier (mono)</option>
        </select>
      </label>
      <div className="field-pair">
        <Num label="Size" value={v.size} min={4} max={200} step={0.5} onChange={(size) => set({ size })} />
        <div className="toggles" role="group" aria-label="Style">
          <button type="button" className="icon-btn" aria-pressed={v.bold} aria-label="Bold" onClick={() => set({ bold: !v.bold })}>
            <Bold size={16} />
          </button>
          <button type="button" className="icon-btn" aria-pressed={v.italic} aria-label="Italic" onClick={() => set({ italic: !v.italic })}>
            <Italic size={16} />
          </button>
        </div>
      </div>
      <Colors label="Colour" value={v.color} onChange={(color) => set({ color })} />
    </>
  );
}

function ItemFields({ item, pageId }: { item: Item; pageId: string }) {
  const s = useStore.getState();
  const set = (patch: Partial<Item>) => s.updateItem(pageId, item.id, patch);

  switch (item.kind) {
    case "text":
      return (
        <>
          <TextFields v={item} set={set} />
          {item.cover && (
            <>
              <Colors label="Background" value={item.cover.color} palette={["#ffffff"]} onChange={(color) => set({ cover: { ...item.cover!, color } })} />
              <p className="note">
                The original text is covered, not deleted, so it can still be selected or searched in some viewers. To remove it completely, also add a Redact box over it.
              </p>
            </>
          )}
        </>
      );
    case "rect":
    case "ellipse":
      return (
        <>
          <Colors label="Outline" value={item.stroke} onChange={(stroke) => set({ stroke })} />
          <Num label="Outline width" value={item.strokeWidth} min={0} max={40} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} />
          <div className="field">
            <span className="field-label">Fill</span>
            <div className="swatches">
              <button type="button" className="swatch none" aria-pressed={!item.fill} aria-label="No fill" onClick={() => set({ fill: null })} />
              {SWATCHES.map((c) => (
                <button key={c} type="button" className="swatch" aria-pressed={item.fill === c} aria-label={c} style={{ background: c }} onClick={() => set({ fill: c })} />
              ))}
            </div>
          </div>
        </>
      );
    case "line":
      return (
        <>
          <Colors label="Colour" value={item.stroke} onChange={(stroke) => set({ stroke })} />
          <Num label="Width" value={item.strokeWidth} min={0.5} max={40} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} />
        </>
      );
    case "ink":
      return (
        <>
          <Colors
            label="Colour"
            value={item.stroke}
            palette={item.highlighter ? HIGHLIGHTS : SWATCHES}
            onChange={(stroke) => set({ stroke })}
          />
          <Num label="Width" value={item.strokeWidth} min={0.5} max={60} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} />
        </>
      );
    case "whiteout":
      return <p className="note">Covers whatever is underneath with white. The covered content is still in the file; use Redact for anything private.</p>;
    case "redact":
      return <p className="note">On download this page is saved as an image, so the text under the box is removed, not just hidden. Text elsewhere on the page stops being selectable.</p>;
    case "image":
      return (
        <p className="note num">
          {Math.round(item.w)} × {Math.round(item.h)} pt. Drag a corner to resize; corners keep the proportions.
        </p>
      );
  }
}

export function Inspector() {
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const selected = useStore((s) => s.selected);
  const item = useStore((s) =>
    s.selected ? s.pages.find((p) => p.id === s.selected!.pageId)?.items.find((i) => i.id === s.selected!.itemId) : undefined,
  );
  const s = useStore.getState();

  if (item && selected) {
    return (
      <aside className="inspector" aria-label="Properties">
        <header className="panel-head">
          <h2>{NAMES[item.kind]}{item.kind === "text" && item.cover ? " (edited)" : ""}</h2>
        </header>
        <div className="fields">
          <ItemFields item={item} pageId={selected.pageId} />
        </div>
        <button type="button" className="btn danger-ghost" onClick={() => s.removeItem(selected.pageId, item.id)}>
          <Trash2 size={16} />
          Delete
        </button>
      </aside>
    );
  }

  const showText = tool === "text" || tool === "edit-text";
  const showShape = tool === "rect" || tool === "ellipse" || tool === "line";

  return (
    <aside className="inspector" aria-label="Properties">
      <header className="panel-head">
        <h2>{tool === "select" ? "Nothing selected" : "Tool settings"}</h2>
      </header>
      <p className="hint">{HINTS[tool]}</p>
      <div className="fields">
        {tool === "text" && (
          <TextFields
            v={{ font: style.font, size: style.size, bold: style.bold, italic: style.italic, color: style.textColor }}
            set={(p) => s.setStyle({ ...p, ...(p.color ? { textColor: p.color } : {}) })}
          />
        )}
        {showShape && (
          <>
            <Colors label="Colour" value={style.stroke} onChange={(stroke) => s.setStyle({ stroke })} />
            <Num label="Width" value={style.strokeWidth} min={0.5} max={40} step={0.5} onChange={(strokeWidth) => s.setStyle({ strokeWidth })} />
          </>
        )}
        {tool === "pen" && (
          <>
            <Colors label="Colour" value={style.penColor} onChange={(penColor) => s.setStyle({ penColor })} />
            <Num label="Width" value={style.penWidth} min={0.5} max={20} step={0.5} onChange={(penWidth) => s.setStyle({ penWidth })} />
          </>
        )}
        {tool === "highlight" && (
          <Colors label="Colour" value={style.highlightColor} palette={HIGHLIGHTS} onChange={(highlightColor) => s.setStyle({ highlightColor })} />
        )}
      </div>
      {!showText && tool === "select" && <Shortcuts />}
    </aside>
  );
}

function Shortcuts() {
  const rows: [string, string][] = [
    ["Undo / Redo", "Ctrl Z / Ctrl Shift Z"],
    ["Delete selected", "Del"],
    ["Zoom", "Ctrl + / Ctrl − or Ctrl scroll"],
    ["Finish typing", "Esc or Ctrl Enter"],
  ];
  return (
    <dl className="shortcuts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
