import { useEffect, useMemo, useState } from "react";
import { Download, FolderDown, RotateCcw, Upload } from "lucide-react";
import { pickFile } from "@/lib/images";
import { cutTile, loadImage, planTiles, type Rect } from "@/lib/split";
import { makeZip } from "@/lib/zip";

const ASPECTS: [string, number | null][] = [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["9:16", 9 / 16],
  ["Keep as cut", null],
];

type Loaded = { file: File; canvas: HTMLCanvasElement; pixels: ImageData; url: string };
type Tile = { rect: Rect; blob: Blob; url: string; name: string };

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImageSplit() {
  const [img, setImg] = useState<Loaded | null>(null);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [trim, setTrim] = useState(true);
  const [aspect, setAspect] = useState("16:9");
  const [format, setFormat] = useState<"image/png" | "image/jpeg">("image/png");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [zipping, setZipping] = useState(false);
  // Pictures left out of the ZIP. Tied to this image and grid, so a new image or grid starts with everything selected.
  const [skip, setSkip] = useState<{ key: string; set: Set<number> }>({ key: "", set: new Set() });
  const pickKey = `${img?.url}:${rows}x${cols}`;
  const skipped = skip.key === pickKey ? skip.set : new Set<number>();
  const chosen = tiles.filter((_, i) => !skipped.has(i));
  const toggle = (i: number) => {
    const next = new Set(skipped);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSkip({ key: pickKey, set: next });
  };

  const choose = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("That isn't an image file.");
      return;
    }
    try {
      const { canvas, pixels } = await loadImage(f);
      setError(null);
      setImg((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { file: f, canvas, pixels, url: URL.createObjectURL(f) };
      });
    } catch {
      setError(`Couldn't open "${f.name}".`);
    }
  };

  const rects = useMemo(
    () =>
      img
        ? planTiles(img.pixels, { rows, cols, trimGutters: trim, aspect: ASPECTS.find(([k]) => k === aspect)?.[1] ?? null })
        : [],
    [img, rows, cols, trim, aspect],
  );

  // Cut the real files whenever the plan changes; the thumbnails are the exact downloads.
  useEffect(() => {
    if (!img) return;
    let live = true;
    const ext = format === "image/png" ? "png" : "jpg";
    Promise.all(
      rects.map(async (rect, i) => {
        const blob = await cutTile(img.canvas, rect, format);
        // Plain 1, 2, 3… in reading order: left to right, then the next row down.
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

  const W = img?.pixels.width ?? 1;
  const H = img?.pixels.height ?? 1;
  const first = tiles[0]?.rect;

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
          void choose(Array.from(e.dataTransfer.files));
        }}
      >
        {!img ? (
          <>
            <div className="grid-glyph" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className={i === 4 ? "mark" : undefined} />
              ))}
            </div>
            <h1>Split an image</h1>
            <p className="lede">Upload a collage, such as 9 pictures in a 3 × 3 grid, and get each picture as its own file.</p>
            <div className="welcome-actions">
              <button type="button" className="btn primary lg" onClick={async () => choose(await pickFile("image/*"))}>
                <Upload size={18} />
                Choose image
              </button>
            </div>
            <p className="fine">Or drop an image here. PNG, JPG and WebP work. Your image stays on this computer.</p>
          </>
        ) : (
          <div className="subs-body">
            <div className="subs-file">
              <div>
                <h1 className="subs-title">{img.file.name}</h1>
                <p className="muted num">
                  {W} × {H} px
                </p>
              </div>
              <button type="button" className="btn ghost" onClick={() => (setImg(null), setTiles([]))}>
                <RotateCcw size={16} />
                Different image
              </button>
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
                <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                  <option value="image/png">PNG (exact)</option>
                  <option value="image/jpeg">JPG (smaller)</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
                Remove borders between pictures
              </label>
            </div>

            <div className="split-pickbar">
              <span>
                <strong className="num">
                  {chosen.length} of {tiles.length}
                </strong>{" "}
                selected
              </span>
              <button type="button" className="btn ghost" disabled={!skipped.size} onClick={() => setSkip({ key: pickKey, set: new Set() })}>
                Select all
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={skipped.size === tiles.length}
                onClick={() => setSkip({ key: pickKey, set: new Set(tiles.map((_, i) => i)) })}
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
              download icon saves just that one. Files keep their grid number, so the ZIP stays in order.
              {trim ? " Shaded areas are borders that get left out." : ""}
            </p>
            <div className="welcome-actions left">
              <button
                type="button"
                className="btn primary lg"
                disabled={!chosen.length || zipping}
                onClick={async () => {
                  setZipping(true);
                  try {
                    save(await makeZip(chosen), `${img.file.name.replace(/\.[^.]+$/, "")}-split.zip`);
                  } finally {
                    setZipping(false);
                  }
                }}
              >
                <FolderDown size={18} />
                {zipping
                  ? "Packing…"
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
