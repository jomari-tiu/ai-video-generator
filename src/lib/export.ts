import {
  LineCapStyle,
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { FontFamily, Item, PageRef } from "@/types";
import { getPage, getSource } from "./pdf";
import { ASCENT, LEADING } from "./text";

type Pt = [number, number];

const FONT_NAMES: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

const color = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** pdf-lib's SVG paths flip y around the origin, so feed it PDF points with y negated. */
const path = (pts: Pt[], close: boolean) =>
  pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${(-y).toFixed(2)}`).join(" ") + (close ? " Z" : "");

const ellipsePoints = (x: number, y: number, w: number, h: number): Pt[] =>
  Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return [x + w / 2 + (w / 2) * Math.cos(a), y + h / 2 + (h / 2) * Math.sin(a)];
  });

async function rasterize(ref: PageRef) {
  const page = await getPage(ref.srcId!, ref.srcIndex);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), "image/jpeg", 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

export type ExportReport = { bytes: Uint8Array; replacedChars: number; flattenedPages: number };

export async function exportPdf(pages: PageRef[]): Promise<ExportReport> {
  const out = await PDFDocument.create();
  const libDocs = new Map<string, PDFDocument>();
  const fonts = new Map<string, PDFFont>();
  const images = new Map<string, PDFImage>();
  let replacedChars = 0;
  let flattenedPages = 0;

  const font = async (f: FontFamily, bold: boolean, italic: boolean) => {
    const name = FONT_NAMES[f][(bold ? 1 : 0) + (italic ? 2 : 0)];
    if (!fonts.has(name)) fonts.set(name, await out.embedFont(name));
    return fonts.get(name)!;
  };

  const image = async (src: string) => {
    if (!images.has(src)) {
      const bytes = await (await fetch(src)).arrayBuffer();
      images.set(src, src.startsWith("data:image/jpeg") ? await out.embedJpg(bytes) : await out.embedPng(bytes));
    }
    return images.get(src)!;
  };

  /** Standard PDF fonts only cover Latin-1-ish text; swap anything else for "?" and count it. */
  const encodable = (f: PDFFont, s: string) =>
    [...s]
      .map((ch) => {
        try {
          f.encodeText(ch);
          return ch;
        } catch {
          replacedChars++;
          return "?";
        }
      })
      .join("");

  for (const ref of pages) {
    const flatten = !!ref.srcId && ref.items.some((i) => i.kind === "redact");
    let page: PDFPage;
    let toPdf: (x: number, y: number) => Pt = (x, y) => [x, ref.height - y];
    let base = 0;

    if (ref.srcId && !flatten) {
      if (!libDocs.has(ref.srcId)) {
        libDocs.set(ref.srcId, await PDFDocument.load(getSource(ref.srcId).bytes, { ignoreEncryption: true }));
      }
      const [copied] = await out.copyPages(libDocs.get(ref.srcId)!, [ref.srcIndex]);
      page = out.addPage(copied);
      const src = await getPage(ref.srcId, ref.srcIndex);
      const vp = src.getViewport({ scale: 1 });
      toPdf = (x, y) => vp.convertToPdfPoint(x, y) as Pt;
      base = src.rotate;
    } else {
      page = out.addPage([ref.width, ref.height]);
      if (flatten) {
        // Redaction must remove the text, not just hide it, so the page becomes an image.
        flattenedPages++;
        const jpg = await out.embedJpg(await rasterize(ref));
        page.drawImage(jpg, { x: 0, y: 0, width: ref.width, height: ref.height });
      }
    }

    const tilt = degrees(base);
    const map = (pts: Pt[]) => pts.map(([x, y]) => toPdf(x, y));
    const box = (x: number, y: number, w: number, h: number): Pt[] => map([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

    for (const item of ref.items as Item[]) {
      switch (item.kind) {
        case "text": {
          if (item.cover) {
            const c = item.cover;
            page.drawSvgPath(path(box(c.x, c.y, c.w, c.h), true), { x: 0, y: 0, color: color(c.color) });
          }
          const f = await font(item.font, item.bold, item.italic);
          item.text.split("\n").forEach((line, i) => {
            if (!line) return;
            const [x, y] = toPdf(item.x, item.y + item.size * (ASCENT + LEADING * i));
            page.drawText(encodable(f, line), { x, y, size: item.size, font: f, color: color(item.color), rotate: tilt });
          });
          break;
        }
        case "rect":
        case "whiteout":
        case "redact":
        case "ellipse": {
          const pts = item.kind === "ellipse" ? map(ellipsePoints(item.x, item.y, item.w, item.h)) : box(item.x, item.y, item.w, item.h);
          const fill = item.kind === "whiteout" ? "#ffffff" : item.kind === "redact" ? "#000000" : item.fill;
          const stroked = item.kind === "rect" || item.kind === "ellipse";
          page.drawSvgPath(path(pts, true), {
            x: 0,
            y: 0,
            ...(fill ? { color: color(fill) } : {}),
            ...(stroked && item.strokeWidth > 0 ? { borderColor: color(item.stroke), borderWidth: item.strokeWidth } : {}),
          });
          break;
        }
        case "line":
          page.drawSvgPath(path(map([[item.x1, item.y1], [item.x2, item.y2]]), false), {
            x: 0,
            y: 0,
            borderColor: color(item.stroke),
            borderWidth: item.strokeWidth,
            borderLineCap: LineCapStyle.Round,
          });
          break;
        case "ink":
          if (item.points.length < 2) break;
          page.drawSvgPath(path(map(item.points), false), {
            x: 0,
            y: 0,
            borderColor: color(item.stroke),
            borderWidth: item.strokeWidth,
            borderOpacity: item.opacity,
            borderLineCap: LineCapStyle.Round,
          });
          break;
        case "image": {
          const img = await image(item.src);
          const [x, y] = toPdf(item.x, item.y + item.h);
          page.drawImage(img, { x, y, width: item.w, height: item.h, rotate: tilt });
          break;
        }
      }
    }

    page.setRotation(degrees(((flatten ? 0 : base) + ref.rotation) % 360));
  }

  return { bytes: await out.save(), replacedChars, flattenedPages };
}

export function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
