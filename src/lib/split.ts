export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SplitOptions {
  rows: number;
  cols: number;
  /** Look for plain-colour gutters and borders and leave them out of the tiles. */
  trimGutters: boolean;
  /** Centre-crop each tile to this aspect (w/h), or null to keep what the grid gives. */
  aspect: number | null;
}

/**
 * Score every column (or row) for how plain it is: the colour spread along its full length.
 * Gutters in a collage run edge to edge in one colour; image content never does across every tile.
 */
function plainness(data: Uint8ClampedArray, W: number, H: number, vertical: boolean): Float32Array {
  const n = vertical ? W : H;
  const len = vertical ? H : W;
  const out = new Float32Array(n);
  const step = Math.max(1, Math.floor(len / 400)); // sample ~400 points per line
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let sum2 = 0;
    let count = 0;
    for (let j = 0; j < len; j += step) {
      const p = 4 * (vertical ? j * W + i : i * W + j);
      const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      sum += lum;
      sum2 += lum * lum;
      count++;
    }
    const mean = sum / count;
    out[i] = Math.sqrt(Math.max(0, sum2 / count - mean * mean));
  }
  return out;
}

const PLAIN = 7; // std-dev in luminance levels below which a line counts as a gutter

/**
 * Find where content starts and ends along one axis, and the gutters between `parts` cells.
 * Returns cell spans [start, end) in pixels.
 */
function spans(score: Float32Array, parts: number, trim: boolean): [number, number][] {
  const n = score.length;
  const plain = (i: number) => score[i] < PLAIN;
  let lo = 0;
  let hi = n;
  if (trim) {
    while (lo < n * 0.2 && plain(lo)) lo++;
    while (hi > n * 0.8 && plain(hi - 1)) hi--;
  }
  const size = hi - lo;
  const cuts: [number, number][] = []; // gutter [start, end) for each internal boundary
  for (let k = 1; k < parts; k++) {
    const at = Math.round(lo + (size * k) / parts);
    let gap: [number, number] = [at, at];
    if (trim) {
      // Nearest plain run within ±8% of the expected position.
      const reach = Math.round(size * 0.08);
      let best = -1;
      for (let d = 0; d <= reach && best < 0; d++) {
        if (at - d >= lo && plain(at - d)) best = at - d;
        else if (at + d < hi && plain(at + d)) best = at + d;
      }
      if (best >= 0) {
        let a = best;
        let b = best + 1;
        while (a > lo && plain(a - 1)) a--;
        while (b < hi && plain(b)) b++;
        // A single plain line is likely a flat area in a photo, not a gutter, unless it sits exactly on the grid.
        if (b - a > 1 || Math.abs(best - at) <= 1) gap = [a, b];
      }
    }
    cuts.push(gap);
  }
  const out: [number, number][] = [];
  let start = lo;
  for (const [a, b] of cuts) {
    out.push([start, a]);
    start = b;
  }
  out.push([start, hi]);
  return out;
}

/** Work out the crop rectangle of every tile, row by row. */
export function planTiles(img: ImageData, o: SplitOptions): Rect[] {
  const { width: W, height: H, data } = img;
  const xs = spans(plainness(data, W, H, true), o.cols, o.trimGutters);
  const ys = spans(plainness(data, W, H, false), o.rows, o.trimGutters);
  const rects: Rect[] = [];
  for (const [y0, y1] of ys) {
    for (const [x0, x1] of xs) {
      let r: Rect = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
      if (o.aspect) r = cropTo(r, o.aspect);
      rects.push(r);
    }
  }
  return rects;
}

function cropTo(r: Rect, aspect: number): Rect {
  if (r.w / r.h > aspect) {
    const w = Math.round(r.h * aspect);
    return { ...r, x: r.x + Math.floor((r.w - w) / 2), w };
  }
  const h = Math.round(r.w / aspect);
  return { ...r, y: r.y + Math.floor((r.h - h) / 2), h };
}

export async function loadImage(file: File) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { canvas: c, pixels: ctx.getImageData(0, 0, c.width, c.height) };
}

export function cutTile(src: HTMLCanvasElement, r: Rect, type: "image/png" | "image/jpeg"): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = r.w;
  c.height = r.h;
  c.getContext("2d")!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't encode tile"))), type, 0.92));
}
