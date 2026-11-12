import type { Item } from "@/types";
import { measureText } from "./text";

export type Box = { x: number; y: number; w: number; h: number };

export function bounds(item: Item): Box {
  switch (item.kind) {
    case "text": {
      const { w, h } = measureText(item);
      return { x: item.x, y: item.y, w, h };
    }
    case "line":
      return {
        x: Math.min(item.x1, item.x2),
        y: Math.min(item.y1, item.y2),
        w: Math.abs(item.x2 - item.x1),
        h: Math.abs(item.y2 - item.y1),
      };
    case "ink": {
      const xs = item.points.map((p) => p[0]);
      const ys = item.points.map((p) => p[1]);
      const pad = item.strokeWidth / 2;
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
    }
    default:
      return { x: item.x, y: item.y, w: item.w, h: item.h };
  }
}

/** Box with non-negative size, for shapes drawn right-to-left or bottom-to-top. */
export const normalize = (b: Box): Box => ({
  x: Math.min(b.x, b.x + b.w),
  y: Math.min(b.y, b.y + b.h),
  w: Math.abs(b.w),
  h: Math.abs(b.h),
});

export function moveItem(item: Item, dx: number, dy: number): Partial<Item> {
  switch (item.kind) {
    case "line":
      return { x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy };
    case "ink":
      return { points: item.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    default:
      return { x: item.x + dx, y: item.y + dy };
  }
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const resizable = (item: Item) =>
  item.kind === "rect" || item.kind === "ellipse" || item.kind === "whiteout" || item.kind === "redact" || item.kind === "image" || item.kind === "line";

/** Resize from the box captured at drag start; images keep their aspect from corner handles. */
export function resizeItem(item: Item, start: Box, handle: Handle, dx: number, dy: number, startItem: Item): Partial<Item> {
  let { x, y, w, h } = start;
  if (handle.includes("w")) [x, w] = [x + dx, w - dx];
  if (handle.includes("e")) w += dx;
  if (handle.includes("n")) [y, h] = [y + dy, h - dy];
  if (handle.includes("s")) h += dy;

  if (item.kind === "image" && handle.length === 2 && start.w && start.h) {
    const ratio = start.w / start.h;
    if (Math.abs(w / ratio) > Math.abs(h)) h = w / ratio;
    else w = h * ratio;
    if (handle.includes("n")) y = start.y + start.h - h;
    if (handle.includes("w")) x = start.x + start.w - w;
  }

  const b = normalize({ x, y, w: Math.abs(w) < 4 ? 4 * Math.sign(w || 1) : w, h: Math.abs(h) < 4 ? 4 * Math.sign(h || 1) : h });

  if (item.kind === "line" && startItem.kind === "line") {
    // Scale both endpoints within the new box.
    const sx = (v: number) => b.x + ((v - start.x) / (start.w || 1)) * b.w;
    const sy = (v: number) => b.y + ((v - start.y) / (start.h || 1)) * b.h;
    return { x1: sx(startItem.x1), y1: sy(startItem.y1), x2: sx(startItem.x2), y2: sy(startItem.y2) };
  }
  return b;
}
