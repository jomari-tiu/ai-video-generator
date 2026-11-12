import type { FontFamily, TextItem } from "@/types";
import { getPage, pdfjs } from "./pdf";

/** Baseline of line i sits at y + size * (ASCENT + LEADING * i). Shared by the editor and export. */
export const ASCENT = 0.9;
export const LEADING = 1.2;
const DESCENT = 0.25;

export const CSS_FAMILY: Record<FontFamily, string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

export const cssFont = (t: Pick<TextItem, "font" | "size" | "bold" | "italic">) =>
  `${t.italic ? "italic " : ""}${t.bold ? "700 " : "400 "}${t.size}px ${CSS_FAMILY[t.font]}`;

let ctx: CanvasRenderingContext2D | null = null;
export function measureText(t: Pick<TextItem, "text" | "font" | "size" | "bold" | "italic">) {
  ctx ??= document.createElement("canvas").getContext("2d")!;
  ctx.font = cssFont(t);
  const lines = t.text.split("\n");
  const w = Math.max(t.size * 0.5, ...lines.map((l) => ctx!.measureText(l).width));
  const h = t.size * (ASCENT + LEADING * (lines.length - 1) + DESCENT);
  return { w, h, lines };
}

export type TextLine = {
  key: string;
  x: number;
  baseline: number;
  size: number;
  width: number;
  text: string;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
};

type RawItem = { str: string; transform: number[]; width: number; fontName: string; hasEOL: boolean };

/** Horizontal text runs of a page, merged into lines, in page units. */
export async function extractLines(srcId: string, index: number): Promise<{ lines: TextLine[]; sideways: number }> {
  const page = await getPage(srcId, index);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const all = (content.items as RawItem[])
    .filter((it) => typeof it.str === "string" && it.str.trim())
    .map((it) => {
      const m = pdfjs.Util.transform(vp.transform, it.transform) as number[];
      const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]);
      return { it, x: m[4], baseline: m[5], size, width: it.width, skew: Math.abs(m[1]) + Math.abs(m[2]) };
    })
    .filter((r) => r.size > 1);
  // Only upright, horizontal runs can be replaced cleanly.
  const runs = all.filter((r) => r.skew < 0.01 * r.size).sort((a, b) => a.baseline - b.baseline || a.x - b.x);

  const lines: TextLine[] = [];
  for (const r of runs) {
    const last = lines[lines.length - 1];
    const sameLine =
      last && Math.abs(last.baseline - r.baseline) < r.size * 0.3 && r.x - (last.x + last.width) < r.size * 0.8 && r.x >= last.x;
    if (sameLine) {
      const gap = r.x - (last.x + last.width);
      const space = gap > r.size * 0.15 && !last.text.endsWith(" ") && !r.it.str.startsWith(" ") ? " " : "";
      last.text += space + r.it.str;
      last.width = r.x + r.width - last.x;
      continue;
    }
    lines.push({
      key: `${index}:${lines.length}:${Math.round(r.x)}:${Math.round(r.baseline)}`,
      x: r.x,
      baseline: r.baseline,
      size: r.size,
      width: r.width,
      text: r.it.str,
      ...guessFont(page, r.it.fontName, content.styles[r.it.fontName]?.fontFamily),
    });
  }
  return { lines, sideways: all.length - runs.length };
}

function guessFont(
  page: { commonObjs: { has(id: string): boolean; get(id: string): unknown } },
  fontName: string,
  family = "",
): { font: FontFamily; bold: boolean; italic: boolean } {
  let name = "";
  try {
    if (page.commonObjs.has(fontName)) name = (page.commonObjs.get(fontName) as { name?: string })?.name ?? "";
  } catch {
    /* font not resolved yet; fall back to the family hint */
  }
  const hint = `${name} ${family}`;
  const font: FontFamily = /courier|mono/i.test(hint)
    ? "Courier"
    : /times|georgia|garamond|minion|cambria|roman|(^|\W)serif/i.test(hint) && !/sans/i.test(hint)
      ? "Times"
      : "Helvetica";
  return { font, bold: /bold|black|heavy|semibold|demi/i.test(name), italic: /italic|oblique/i.test(name) };
}

/** Sample the rendered page to find a run's ink colour and the paper colour behind it. */
export function sampleColors(canvas: HTMLCanvasElement, pageWidth: number, box: { x: number; y: number; w: number; h: number }) {
  const s = canvas.width / pageWidth;
  const x = Math.max(0, Math.floor(box.x * s));
  const y = Math.max(0, Math.floor(box.y * s));
  const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(box.w * s)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(box.h * s)));
  const data = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(x, y, w, h).data;

  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const q = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  let bgQ = 0xfff;
  let best = -1;
  for (const [q, c] of counts) if (c > best) [bgQ, best] = [q, c];
  const bg = [(bgQ >> 8) * 17, ((bgQ >> 4) & 15) * 17, (bgQ & 15) * 17];

  let ink = [0, 0, 0];
  let far = -1;
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (d > far) [far, ink] = [d, [data[i], data[i + 1], data[i + 2]]];
  }
  const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return { ink: far > 60 ? hex(ink) : "#000000", paper: hex(bg) };
}
