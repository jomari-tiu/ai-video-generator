import { useEffect, useMemo, useState } from "react";
import { Download, FolderDown, ImagePlus, RotateCcw, Upload, X } from "lucide-react";
import { pickFile } from "@/lib/images";
import { cutTile, loadImage, planTiles, type Rect, type SplitOptions } from "@/lib/split";
import { makeZip } from "@/lib/zip";

const ASPECTS: [string, number | null][] = [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["9:16", 9 / 16],
  ["Keep as cut", null],
];

type Loaded = { id: number; file: File; canvas: HTMLCanvasElement; pixels: ImageData; url: string };
type Tile = { rect: Rect; blob: Blob; url: string; name: string };
type Format = "image/png" | "image/jpeg";

let nextId = 1;
const NONE: ReadonlySet<number> = new Set();
const naturally = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const baseName = (f: File) => f.name.replace(/\.[^.]+$/, "");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One ZIP per image: its kept pictures, named by grid number (1, 2, 3… left to right, top to bottom). */
async function zipFor(img: Loaded, opts: SplitOptions, format: Format, skipped: ReadonlySet<number>) {
  const ext = format === "image/png" ? "png" : "jpg";
  const rects = planTiles(img.pixels, opts);
  const files = await Promise.all(
    rects.map(async (r, i) => (skipped.has(i) ? null : { name: `${i + 1}.${ext}`, blob: await cutTile(img.canvas, r, format) })),
  );
  return makeZip(files.filter((f): f is { name: string; blob: Blob } => !!f));
}

export function ImageSplit() {
  const [imgs, setImgs] = useState<Loaded[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [trim, setTrim] = useState(true);
  const [aspect, setAspect] = useState("16:9");
  const [format, setFormat] = useState<Format>("image/png");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Pictures left out, per image and grid size; a new grid starts with everything selected.
  const [skips, setSkips] = useState<Record<string, Set<number>>>({});

  const img = imgs.find((i) => i.id === activeId) ?? imgs[0] ?? null;
  const grid = `${rows}x${cols}`;
  const count = rows * cols;
  const skippedOf = (id: number): ReadonlySet<number> => skips[`${id}:${grid}`] ?? NONE;
  const keptOf = (id: number) => count - [...skippedOf(id)].filter((i) => i < count).length;
  const skipped = img ? skippedOf(img.id) : NONE;
  const setSkipped = (set: Set<number>) => img && setSkips((s) => ({ ...s, [`${img.id}:${grid}`]: set }));
  const toggle = (i: number) => {
    const next = new Set(skipped);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSkipped(next);
  };

  const opts: SplitOptions = useMemo(
    () => ({ rows, cols, trimGutters: trim, aspect: ASPECTS.find(([k]) => k === aspect)?.[1] ?? null }),
    [rows, cols, trim, aspect],
  );
  const rects = useMemo(() => (img ? planTiles(img.pixels, opts) : []), [img, opts]);
  const chosen = tiles.filter((_, i) => !skipped.has(i));

  const add = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith("image/")).sort(naturally);
    if (!pics.length) {
      if (files.length) setError("Those aren't image files.");
      return;
    }
    setBusy(`Opening ${pics.length} image${pics.length > 1 ? "s" : ""}…`);
    const loaded: Loaded[] = [];
    const failed: string[] = [];
    for (const f of pics) {
      try {
        const { canvas, pixels } = await loadImage(f);
        loaded.push({ id: nextId++, file: f, canvas, pixels, url: URL.createObjectURL(f) });
      } catch {
        failed.push(f.name);
      }
    }
    setError(failed.length ? `Couldn't open ${failed.map((n) => `"${n}"`).join(", ")}.` : null);
    if (loaded.length) {
      setImgs((x) => [...x, ...loaded]);
      setActiveId((a) => a ?? loaded[0].id);
    }
    setBusy(null);
  };

  const remove = (id: number) => {
    const gone = imgs.find((i) => i.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    const rest = imgs.filter((i) => i.id !== id);
    setImgs(rest);
    if (id === img?.id) setActiveId(rest[0]?.id ?? null);
    if (!rest.length) setTiles([]);
  };
  const clearAll = () => {
    imgs.forEach((i) => URL.revokeObjectURL(i.url));
    setImgs([]);
    setActiveId(null);
    setTiles([]);
    setSkips({});
    setError(null);
  };

  // Cut the shown image's pictures whenever the plan changes; the thumbnails are the exact downloads.
  useEffect(() => {
    if (!img) return;
    let live = true;
    const ext = format === "image/png" ? "png" : "jpg";
    Promise.all(
      rects.map(async (rect, i) => {
        const blob = await cutTile(img.canvas, rect, format);
        return { rect, blob, url: URL.createObjectURL(blob), name: `${i + 1}.${ext}` };
      }),
    ).then((t) => {
      if (live) setTiles(t);
      else t.forEach((x) => URL.revokeObjectURL(x.url));
    });
    return () => {
      live = false;
    };
  }, [img, rects, format]);
  useEffect(() => () => tiles.forEach((t) => URL.revokeObjectURL(t.url)), [tiles]);

  // ZIP names follow the image names; two images with the same name get (2), (3)…
  const zipNames = useMemo(() => {
    const seen = new Map<string, number>();
    return new Map(
      imgs.map((i) => {
        const b = baseName(i.file);
        const n = (seen.get(b) ?? 0) + 1;
        seen.set(b, n);
        return [i.id, `${b}${n > 1 ? ` (${n})` : ""}-split.zip`];
      }),
    );
  }, [imgs]);

  const downloadOne = async (im: Loaded) => {
    setBusy("Packing…");
    try {
      save(await zipFor(im, opts, format, skippedOf(im.id)), zipNames.get(im.id)!);
    } finally {
      setBusy(null);
    }
  };
  const downloadAll = async () => {
    const todo = imgs.filter((i) => keptOf(i.id) > 0);
    try {
      for (const [n, im] of todo.entries()) {
        setBusy(`Packing ZIP ${n + 1} of ${todo.length}…`);
        save(await zipFor(im, opts, format, skippedOf(im.id)), zipNames.get(im.id)!);
        await wait(350); // browsers drop downloads that arrive all at once
      }
    } finally {
      setBusy(null);
    }
  };

  const W = img?.pixels.width ?? 1;
  const H = img?.pixels.height ?? 1;
  const first = tiles[0]?.rect;
  const zipCount = imgs.filter((i) => keptOf(i.id) > 0).length;

  return (
    <main className="welcome">
      <div
        className={`dropzone subs split${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(Array.from(e.dataTransfer.files));
        }}
      >
        {!img ? (
          <>
            <div className="grid-glyph" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className={i === 4 ? "mark" : undefined} />
              ))}
            </div>
            <h1>Split images</h1>
            <p className="lede">
              Upload one or more collages, such as 9 pictures in a 3 × 3 grid, and get each picture as its own file. Each image gets
              its own ZIP.
            </p>
            <div className="welcome-actions">
              <button type="button" className="btn primary lg" disabled={!!busy} onClick={async () => add(await pickFile("image/*", true))}>
                <Upload size={18} />
                {busy ?? "Choose images"}
              </button>
            </div>
            <p className="fine">Or drop images here. PNG, JPG and WebP work; pick as many as you like. Your images stay on this computer.</p>
          </>
        ) : (
          <div className="subs-body">
            <div className="subs-file">
              <div>
                <h1 className="subs-title">
                  {imgs.length} image{imgs.length > 1 ? "s" : ""}
                </h1>
                <p className="muted">Settings apply to every image. Pick the pictures to keep for each one.</p>
              </div>
              <div className="split-head-actions">
                <button type="button" className="btn ghost" disabled={!!busy} onClick={async () => add(await pickFile("image/*", true))}>
                  <ImagePlus size={16} />
                  Add images
                </button>
                <button type="button" className="btn ghost" disabled={!!busy} onClick={clearAll}>
                  <RotateCcw size={16} />
                  Clear all
                </button>
              </div>
            </div>

            {imgs.length > 1 && (
              <ul className="split-batch" aria-label="Images">
                {imgs.map((im) => {
                  const kept = keptOf(im.id);
                  return (
                    <li key={im.id} className={im.id === img.id ? "on" : undefined}>
                      <button type="button" onClick={() => setActiveId(im.id)} aria-pressed={im.id === img.id} title={im.file.name}>
                        <img src={im.url} alt="" />
                        <span className="split-batch-name">{im.file.name}</span>
                        <span className={`split-batch-count num${kept ? "" : " none"}`}>
                          {kept ? `${kept} of ${count}` : "none, no ZIP"}
                        </span>
                      </button>
                      <button type="button" className="icon-btn split-batch-x" aria-label={`Remove ${im.file.name}`} onClick={() => remove(im.id)}>
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="subs-row">
              <label className="field small">
                <span>Rows</span>
                <input type="number" min={1} max={10} value={rows} onChange={(e) => setRows(Math.min(10, Math.max(1, +e.target.value || 1)))} />
              </label>
              <label className="field small">
                <span>Columns</span>
                <input type="number" min={1} max={10} value={cols} onChange={(e) => setCols(Math.min(10, Math.max(1, +e.target.value || 1)))} />
              </label>
              <label className="field">
                <span>Each picture</span>
                <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  {ASPECTS.map(([k]) => (
                    <option key={k} value={k}>
                      {k === "Keep as cut" ? k : `${k}${k === "16:9" ? " (widescreen)" : ""}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Format</span>
                <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                  <option value="image/png">PNG (exact)</option>
                  <option value="image/jpeg">JPG (smaller)</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
                Remove borders between pictures
              </label>
            </div>

            <div className="split-current">
              <strong>{img.file.name}</strong>
              <span className="muted num">
                {W} × {H} px
              </span>
            </div>
            <div className="split-preview">
              <img src={img.url} alt="" />
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <defs>
                  <mask id="keep">
                    <rect width={W} height={H} fill="white" />
                    {rects.map((r, i) => (
                      <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="black" />
                    ))}
                  </mask>
                </defs>
                <rect width={W} height={H} className="split-cutaway" mask="url(#keep)" />
                {rects.map((r, i) => (
                  <g key={i}>
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} className="split-tile" vectorEffect="non-scaling-stroke" />
                    <text x={r.x + r.w / 2} y={r.y + r.h / 2} className="split-num" fontSize={Math.min(r.w, r.h) * 0.22}>
                      {i + 1}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <div className="split-pickbar">
              <span>
                <strong className="num">
                  {chosen.length} of {tiles.length}
                </strong>{" "}
                selected
              </span>
              <button type="button" className="btn ghost" disabled={!skipped.size} onClick={() => setSkipped(new Set())}>
                Select all
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={skipped.size >= tiles.length}
                onClick={() => setSkipped(new Set(tiles.map((_, i) => i)))}
              >
                Select none
              </button>
            </div>

            <ol className="split-tiles" aria-label="Pictures" style={{ ["--cols" as string]: Math.min(cols, 5) }}>
              {tiles.map((t, i) => {
                const on = !skipped.has(i);
                return (
                  <li key={t.url} className={on ? undefined : "off"}>
                    <label className="split-pick" title={on ? "Click to leave this picture out" : "Click to include this picture"}>
                      <input type="checkbox" checked={on} onChange={() => toggle(i)} aria-label={`Include picture ${i + 1}`} />
                      <img src={t.url} alt={`Picture ${i + 1}`} style={{ aspectRatio: `${t.rect.w} / ${t.rect.h}` }} />
                      {!on && <span className="split-skip">Skipped</span>}
                    </label>
                    <div className="split-meta">
                      <span>{i + 1}</span>
                      <button type="button" className="icon-btn" onClick={() => save(t.blob, t.name)} title={`Download ${t.name} only`} aria-label={`Download picture ${i + 1} only`}>
                        <Download size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>

            <p className="fine left">
              {tiles.length} pictures{first ? `, each ${first.w} × ${first.h} px` : ""}. Click a picture to leave it out of the ZIP; the
              download icon saves just that one. Files keep their grid number, so each ZIP stays in order.
              {trim ? " Shaded areas are borders that get left out." : ""}
              {imgs.length > 1 && " Your browser may ask once to allow several downloads."}
            </p>
            <div className="welcome-actions left">
              {imgs.length > 1 && (
                <button type="button" className="btn primary lg" disabled={!zipCount || !!busy} onClick={downloadAll}>
                  <FolderDown size={18} />
                  {busy ?? `Download all ${zipCount} ZIP${zipCount === 1 ? "" : "s"}`}
                </button>
              )}
              <button
                type="button"
                className={`btn ${imgs.length > 1 ? "ghost" : "primary"} lg`}
                disabled={!chosen.length || !!busy}
                onClick={() => downloadOne(img)}
              >
                <FolderDown size={18} />
                {imgs.length === 1 && busy
                  ? busy
                  : imgs.length > 1
                    ? "Download this one's ZIP"
                    : chosen.length === tiles.length
                      ? `Download all ${tiles.length} (ZIP)`
                      : `Download ${chosen.length} selected (ZIP)`}
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="subs-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
