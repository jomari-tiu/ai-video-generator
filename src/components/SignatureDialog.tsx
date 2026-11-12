import { useEffect, useRef, useState } from "react";
import { placeImage } from "@/lib/images";

const W = 560;
const H = 200;

/** Crop the drawn strokes to their bounds so the placed signature has no empty margin. */
function trimmed(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let [x0, y0, x1, y1] = [width, height, 0, 0];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + pad * 2;
  out.height = y1 - y0 + pad * 2;
  out.getContext("2d")!.drawImage(canvas, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function SignatureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);
  const [empty, setEmpty] = useState(true);
  const [color, setColor] = useState("#1b1d22");

  useEffect(() => {
    const d = dialog.current!;
    if (open && !d.open) {
      d.showModal();
      const c = canvas.current!;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = W * dpr;
      c.height = H * dpr;
      c.getContext("2d")!.scale(dpr, dpr);
      setEmpty(true);
    }
    if (!open && d.open) d.close();
  }, [open]);

  const point = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  const stroke = (to: [number, number]) => {
    const ctx = canvas.current!.getContext("2d")!;
    const from = last.current ?? to;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0] + (from === to ? 0.01 : 0), to[1]);
    ctx.stroke();
    last.current = to;
    setEmpty(false);
  };

  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  const add = () => {
    const out = trimmed(canvas.current!);
    if (!out) return;
    const dpr = canvas.current!.width / W;
    placeImage(out.toDataURL("image/png"), out.width / dpr, out.height / dpr, true);
    onClose();
  };

  return (
    <dialog ref={dialog} className="sig-dialog" onClose={onClose} aria-labelledby="sig-title">
      <h2 id="sig-title">Draw your signature</h2>
      <canvas
        ref={canvas}
        className="sig-pad"
        style={{ aspectRatio: `${W} / ${H}` }}
        aria-label="Signature pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = null;
          stroke(point(e));
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) stroke(point(e));
        }}
        onPointerUp={() => (last.current = null)}
      />
      <div className="sig-row">
        <div className="swatches" role="radiogroup" aria-label="Ink colour">
          {["#1b1d22", "#1f3fa8"].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c === "#1b1d22" ? "Black ink" : "Blue ink"} className="swatch" style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <button type="button" className="btn ghost" onClick={clear} disabled={empty}>
          Clear
        </button>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={add} disabled={empty}>
          Place signature
        </button>
      </div>
    </dialog>
  );
}
