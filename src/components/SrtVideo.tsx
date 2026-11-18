import { useEffect, useMemo, useRef, useState } from "react";
import { Captions, Download, Film, ImageIcon, Music, X } from "lucide-react";
import { pickFile } from "@/lib/images";
import { parseSrt, timecode, type Cue } from "@/lib/srt";
import { mimeFor, unzip } from "@/lib/unzip";
import { buildSegments, defaultAssign, drawFrame, makeClick, renderVideo, type Look } from "@/lib/videoRender";

const SIZES: Record<string, [number, number]> = {
  "1080p": [1920, 1080],
  "720p": [1280, 720],
  "Vertical 1080 × 1920": [1080, 1920],
  "Square 1080": [1080, 1080],
};
const FPS = 30;

type Img = { file: File; bmp: ImageBitmap; url: string };
type Aud = { file: File; buffer: AudioBuffer; url: string };
type Render =
  | { step: "idle" }
  | { step: "rendering"; pct: number }
  | { step: "done"; url: string; size: number; seconds: number };

const naturally = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const isSrt = (f: File) => /\.(srt|vtt)$/i.test(f.name);
const isZip = (f: File) => /\.zip$/i.test(f.name) || /zip/.test(f.type);

/** Decode an image, shrinking very large ones so dozens of pictures stay light in memory. */
async function loadBitmap(f: File) {
  const bmp = await createImageBitmap(f);
  const k = 2160 / Math.max(bmp.width, bmp.height);
  if (k >= 1) return bmp;
  // Read the size before closing: a closed bitmap reports 0 × 0.
  const resizeWidth = Math.max(1, Math.round(bmp.width * k));
  const resizeHeight = Math.max(1, Math.round(bmp.height * k));
  bmp.close();
  return createImageBitmap(f, { resizeWidth, resizeHeight, resizeQuality: "high" });
}
const isAudio = (f: File) => /^(audio|video)\//.test(f.type) || /\.(mp3|m4a|wav|ogg|aac|mp4)$/i.test(f.name);
const mmss = (s: number) => timecode(s).slice(3, 8);

// One shared context for the preview click, created on first use (after a user gesture).
let sound: { ctx: AudioContext; buf: AudioBuffer } | null = null;
function playClick() {
  if (!sound) {
    const ctx = new AudioContext();
    const data = makeClick(ctx.sampleRate);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    sound = { ctx, buf };
  }
  const src = sound.ctx.createBufferSource();
  src.buffer = sound.buf;
  src.connect(sound.ctx.destination);
  src.start();
}

export function SrtVideo() {
  const [srt, setSrt] = useState<{ name: string; cues: Cue[] } | null>(null);
  const [images, setImages] = useState<Img[]>([]);
  const [audio, setAudio] = useState<Aud | null>(null);
  const [manual, setManual] = useState<{ key: string; values: number[] } | null>(null);
  const [size, setSize] = useState("1080p");
  const [fit, setFit] = useState<Look["fit"]>("cover");
  const [captions, setCaptions] = useState(true);
  const [zoom, setZoom] = useState(true);
  const [fade, setFade] = useState(true);
  const [click, setClick] = useState(true);
  const [zipCount, setZipCount] = useState(0);
  const lastSeg = useRef(-1);
  const [render, setRender] = useState<Render>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<HTMLAudioElement>(null);
  const abort = useRef<AbortController | null>(null);

  const cues = useMemo(() => srt?.cues ?? [], [srt]);
  const [W, H] = SIZES[size];
  const look: Look = useMemo(
    () => ({ width: W, height: H, fit, captions, captionSize: H > W ? 0.034 : 0.055, zoom, fade }),
    [W, H, fit, captions, zoom, fade],
  );
  const duration = Math.max(audio?.buffer.duration ?? 0, cues.at(-1)?.end ?? 0);
  const bitmaps = useMemo(() => images.map((i) => i.bmp), [images]);
  const ready = !!(srt && images.length && audio);

  // Manual picks belong to one set of inputs; new subtitles or images start again from an even spread.
  const key = `${srt?.name}:${cues.length}:${images.length}`;
  const assign = useMemo(
    () => (manual?.key === key ? manual.values : defaultAssign(cues.length, images.length)),
    [manual, key, cues.length, images.length],
  );
  const setAssign = (f: (a: number[]) => number[]) => setManual({ key, values: f(assign) });
  const segs = useMemo(() => buildSegments(cues, assign, duration), [cues, assign, duration]);

  const paint = (t: number) => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) drawFrame(ctx, t, look, segs, cues, bitmaps);
  };

  // Redraw on any change, and follow the audio while it plays.
  useEffect(() => {
    paint(player.current?.currentTime ?? 0);
    let raf = 0;
    const segAt = (t: number) => {
      let i = segs.length - 1;
      while (i > 0 && t < segs[i].start) i--;
      return i;
    };
    const loop = () => {
      const t = player.current?.currentTime ?? 0;
      paint(t);
      // Click when playback crosses into a new image (not when scrubbing).
      const s = segAt(t);
      if (click && s > 0 && s === lastSeg.current + 1) playClick();
      lastSeg.current = s;
      raf = requestAnimationFrame(loop);
    };
    const a = player.current;
    const start = () => {
      lastSeg.current = segAt(a?.currentTime ?? 0);
      raf = requestAnimationFrame(loop);
    };
    const stop = () => cancelAnimationFrame(raf);
    const seek = () => {
      lastSeg.current = segAt(a?.currentTime ?? 0);
      paint(a?.currentTime ?? 0);
    };
    a?.addEventListener("play", start);
    a?.addEventListener("pause", stop);
    a?.addEventListener("seeked", seek);
    if (a && !a.paused) start();
    return () => {
      stop();
      a?.removeEventListener("play", start);
      a?.removeEventListener("pause", stop);
      a?.removeEventListener("seeked", seek);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look, segs, cues, bitmaps, audio, click]);


  // Free object URLs and bitmaps when inputs are replaced.
  useEffect(() => () => images.forEach((i) => (URL.revokeObjectURL(i.url), i.bmp.close())), [images]);
  useEffect(() => () => void (audio && URL.revokeObjectURL(audio.url)), [audio]);
  useEffect(() => () => void (render.step === "done" && URL.revokeObjectURL(render.url)), [render]);

  const add = async (files: File[]) => {
    setError(null);
    setBusy(true);
    try {
      const srtFile = files.find(isSrt);
      // Images and ZIPs of images, in name order; a ZIP's pictures go where the ZIP sorts, in their own name order.
      const sources = files.filter((f) => f.type.startsWith("image/") || isZip(f)).sort(naturally);
      const zips = sources.filter(isZip).length;
      const imgFiles: File[] = [];
      for (const f of sources) {
        if (!isZip(f)) {
          imgFiles.push(f);
          continue;
        }
        let entries;
        try {
          entries = await unzip(f);
        } catch (e) {
          throw new Error(`Couldn't open "${f.name}": ${(e as Error).message}.`, { cause: e });
        }
        const pics = entries
          .filter((e) => mimeFor(e.name))
          .map((e) => new File([e.blob], `${f.name.replace(/\.zip$/i, "")}/${e.name.split("/").pop()}`, { type: e.blob.type }))
          .sort(naturally);
        if (!pics.length) throw new Error(`"${f.name}" has no images in it.`);
        imgFiles.push(...pics);
      }
      const audFile = files.find((f) => !isSrt(f) && !f.type.startsWith("image/") && !isZip(f) && isAudio(f));
      if (!srtFile && !imgFiles.length && !audFile) {
        setError("Add an .srt file, images, or an audio file (MP3, M4A, WAV, or an MP4's soundtrack).");
        return;
      }
      if (srtFile) {
        const parsed = parseSrt(await srtFile.text());
        if (!parsed.length) setError(`No subtitles found in "${srtFile.name}".`);
        else setSrt({ name: srtFile.name, cues: parsed });
      }
      if (imgFiles.length) {
        const loaded = await Promise.all(imgFiles.map(async (f) => ({ file: f, bmp: await loadBitmap(f), url: URL.createObjectURL(f) })));
        setImages(loaded);
        setZipCount(zips);
      }
      if (audFile) {
        const ctx = new AudioContext();
        try {
          const buffer = await ctx.decodeAudioData(await audFile.arrayBuffer());
          setAudio({ file: audFile, buffer, url: URL.createObjectURL(audFile) });
        } catch {
          setError(`Couldn't read the audio in "${audFile.name}".`);
        } finally {
          void ctx.close();
        }
      }
      setRender({ step: "idle" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const make = async () => {
    if (!audio) return;
    player.current?.pause();
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRender({ step: "rendering", pct: 0 });
    const t0 = performance.now();
    try {
      const blob = await renderVideo({
        look,
        fps: FPS,
        cues,
        segs,
        images: bitmaps,
        audio: audio.buffer,
        duration,
        signal: ctrl.signal,
        onProgress: (pct) => setRender({ step: "rendering", pct }),
      });
      setRender({ step: "done", url: URL.createObjectURL(blob), size: blob.size, seconds: (performance.now() - t0) / 1000 });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(`Couldn't make the video: ${(e as Error).message}`);
      setRender({ step: "idle" });
    }
  };

  const base = (srt?.name ?? audio?.file.name ?? "video").replace(/\.[^.]+$/, "");
  const rendering = render.step === "rendering";

  const option = (on: boolean, set: (v: boolean) => void, title: string, note: string) => (
    <label className="vid-option">
      <input type="checkbox" checked={on} disabled={rendering} onChange={(e) => set(e.target.checked)} />
      <span>
        <strong>{title}</strong>
        <span className="muted">{note}</span>
      </span>
    </label>
  );

  const slot = (icon: React.ReactNode, label: string, value: string | null, accept: string, multiple = false) => (
    <button type="button" className={`vid-slot${value ? " filled" : ""}`} disabled={rendering} onClick={async () => add(await pickFile(accept, multiple))}>
      {icon}
      <span>
        <strong>{label}</strong>
        <span className="muted">{value ?? "Choose…"}</span>
      </span>
    </button>
  );

  return (
    <main className="welcome">
      <div
        className={`dropzone subs split${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!rendering) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!rendering) void add(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="subs-body">
          <div>
            <h1 className="subs-title">SRT video generator</h1>
            <p className="muted">
              Add subtitles, images and audio. Each subtitle line shows an image; the audio plays underneath. Drop all three at
              once if you like.
            </p>
          </div>

          <div className="vid-slots">
            {slot(<Captions size={20} />, "Subtitles (.srt)", srt ? `${srt.name} · ${srt.cues.length} lines` : null, ".srt,.vtt")}
            {slot(
              <ImageIcon size={20} />,
              "Images or ZIPs",
              images.length
                ? `${images.length} image${images.length > 1 ? "s" : ""}${zipCount ? ` from ${zipCount} ZIP${zipCount > 1 ? "s" : ""}` : ""}, in order`
                : null,
              "image/*,.zip,application/zip",
              true,
            )}
            {slot(<Music size={20} />, "Audio", audio ? `${audio.file.name} · ${mmss(audio.buffer.duration)}` : null, "audio/*,.mp3,.m4a,.wav,.mp4")}
          </div>
          {busy && <p className="muted">Loading files…</p>}

              <div className="subs-row">
                <label className="field">
                  <span>Size</span>
                  <select value={size} disabled={rendering} onChange={(e) => setSize(e.target.value)}>
                    {Object.keys(SIZES).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Images</span>
                  <select value={fit} disabled={rendering} onChange={(e) => setFit(e.target.value as Look["fit"])}>
                    <option value="cover">Fill the frame (crop edges)</option>
                    <option value="contain">Show whole image</option>
                  </select>
                </label>
              </div>
              <div className="vid-options">
                {option(captions, setCaptions, "Burn in subtitles", "Draw each subtitle line on the video, bottom centre.")}
                {option(zoom, setZoom, "Apply animated zoom", "Zoom each image between 100% and 105%.")}
                {option(fade, setFade, "Crossfade between images", "Blend into the next image over half a second.")}
                {option(click, setClick, "Play image-change sound", "Click in the preview whenever a new image starts. Never added to the downloaded video.")}
              </div>

          {ready && (
            <>
              <div className="vid-stage">
                <canvas ref={canvas} width={W} height={H} className={H > W ? "tall" : undefined} style={{ aspectRatio: `${W} / ${H}` }} />
              </div>
              <audio ref={player} src={audio.url} controls className="subs-media" />

              <ol className="cue-list vid-cues" aria-label="Image for each subtitle">
                {cues.map((c, i) => (
                  <li
                    key={i}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).tagName === "SELECT" || !player.current) return;
                      player.current.currentTime = c.start;
                    }}
                  >
                    <span className="num muted">{mmss(c.start)}</span>
                    <span className="vid-cue-text">{c.text}</span>
                    <img src={images[assign[i] ?? 0]?.url} alt="" />
                    <select
                      value={assign[i] ?? 0}
                      disabled={rendering}
                      aria-label={`Image for line ${i + 1}`}
                      onChange={(e) => setAssign((a) => a.map((v, j) => (j === i ? +e.target.value : v)))}
                    >
                      {images.map((img, j) => (
                        <option key={j} value={j}>
                          {j + 1}. {img.file.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ol>
              <p className="fine left">
                {segs.length} image change{segs.length === 1 ? "" : "s"} over {mmss(duration)}.{" "}
                {images.length !== cues.length &&
                  `${images.length} images for ${cues.length} lines, so images are spread evenly; change any line above.`}
              </p>

              {rendering ? (
                <div className="subs-progress" role="status">
                  <div className="subs-progress-head">
                    <span>Making video… {Math.round(render.pct * 100)}%</span>
                    <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>
                      <X size={16} />
                      Cancel
                    </button>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${(render.pct * 100).toFixed(1)}%` }} />
                  </div>
                </div>
              ) : render.step === "done" ? (
                <div className="vid-result">
                  <video src={render.url} controls className={H > W ? "tall" : undefined} style={{ aspectRatio: `${W} / ${H}` }} />
                  <p className="fine left">
                    {W} × {H}, {mmss(duration)}, {(render.size / 1e6).toFixed(1)} MB · made in {render.seconds.toFixed(0)} s
                  </p>
                  <div className="welcome-actions left">
                    <a className="btn primary lg" href={render.url} download={`${base}.mp4`}>
                      <Download size={18} />
                      Download MP4
                    </a>
                    <button type="button" className="btn ghost lg" onClick={make}>
                      Make again
                    </button>
                  </div>
                </div>
              ) : (
                <div className="welcome-actions left">
                  <button type="button" className="btn primary lg" onClick={make}>
                    <Film size={18} />
                    Make video
                  </button>
                </div>
              )}
            </>
          )}
          {error && (
            <p className="subs-error" role="alert">
              {error}
            </p>
          )}
          {!ready && <p className="fine left">Everything is processed on this computer; nothing is uploaded.</p>}
        </div>
      </div>
    </main>
  );
}
