import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, Film, GripVertical, ImagePlus, Music, Pause, Play, RotateCcw, Trash2, Video, X } from "lucide-react";
import { pickFile } from "@/lib/images";
import { timecode } from "@/lib/srt";
import { mimeFor, unzip } from "@/lib/unzip";
import { drawMontage, layout, mixAudio, renderMontage, TRANSITIONS, type Frame, type MontageLook, type Transition } from "@/lib/montage";

const SIZES: Record<string, [number, number]> = {
  "1080p": [1920, 1080],
  "720p": [1280, 720],
  "Vertical 1080 × 1920": [1080, 1920],
  "Square 1080": [1080, 1080],
};
const FPS = 30;
const LENGTHS = [0.3, 0.5, 0.75, 1, 1.5];

type Item = {
  id: number;
  kind: "image" | "video";
  file: File;
  url: string;
  w: number;
  h: number;
  /** A video's own length; pictures use `hold` or the default. */
  length: number;
  hold: number | null;
  bmp?: ImageBitmap;
  el?: HTMLVideoElement;
  sound: AudioBuffer | null;
};
type Render =
  | { step: "idle" }
  | { step: "rendering"; pct: number }
  | { step: "done"; url: string; size: number; seconds: number };

let nextId = 1;
const naturally = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const isZip = (f: File) => /\.zip$/i.test(f.name) || /zip/.test(f.type);
const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(f.name);
const isMusic = (f: File) => f.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac)$/i.test(f.name);
const mmss = (s: number) => timecode(s).slice(3, 8);

async function decodeSound(f: File): Promise<AudioBuffer | null> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await f.arrayBuffer());
  } catch {
    return null; // silent video, or a codec the browser can't read
  } finally {
    void ctx.close();
  }
}

async function loadImage(f: File): Promise<Item> {
  let bmp = await createImageBitmap(f);
  const k = 2160 / Math.max(bmp.width, bmp.height);
  if (k < 1) {
    // Read the size before closing: a closed bitmap reports 0 × 0.
    const resizeWidth = Math.max(1, Math.round(bmp.width * k));
    const resizeHeight = Math.max(1, Math.round(bmp.height * k));
    bmp.close();
    bmp = await createImageBitmap(f, { resizeWidth, resizeHeight, resizeQuality: "high" });
  }
  return { id: nextId++, kind: "image", file: f, url: URL.createObjectURL(f), w: bmp.width, h: bmp.height, length: 0, hold: null, bmp, sound: null };
}

async function loadVideo(f: File): Promise<Item> {
  const url = URL.createObjectURL(f);
  const el = document.createElement("video");
  el.preload = "auto";
  el.playsInline = true;
  el.src = url;
  await new Promise<void>((ok, fail) => {
    el.onloadeddata = () => ok();
    el.onerror = () => fail(new Error(`Couldn't open the video "${f.name}".`));
  });
  if (!isFinite(el.duration) || !el.videoWidth) throw new Error(`"${f.name}" doesn't look like a playable video.`);
  return {
    id: nextId++,
    kind: "video",
    file: f,
    url,
    w: el.videoWidth,
    h: el.videoHeight,
    length: el.duration,
    hold: null,
    el,
    sound: await decodeSound(f),
  };
}

function free(it: Item) {
  it.el?.pause();
  it.el?.removeAttribute("src");
  it.bmp?.close();
  URL.revokeObjectURL(it.url);
}

export function ImageToVideo() {
  const [items, setItems] = useState<Item[]>([]);
  const [seconds, setSeconds] = useState(2);
  // On: one time for every picture. Off: each picture can have its own (new ones start at `seconds`).
  const [same, setSame] = useState(true);
  const [transition, setTransition] = useState<Transition>("fade");
  const [trLength, setTrLength] = useState(0.5);
  const [size, setSize] = useState("1080p");
  const [fit, setFit] = useState<MontageLook["fit"]>("cover");
  const [zoom, setZoom] = useState(true);
  const [keepSound, setKeepSound] = useState(true);
  const [music, setMusic] = useState<{ file: File; buffer: AudioBuffer; url: string } | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.5);
  const [render, setRender] = useState<Render>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [nudge, setNudge] = useState(0); // bumped to redraw a paused preview after a seek
  const canvas = useRef<HTMLCanvasElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  const clockLabel = useRef<HTMLSpanElement>(null);
  const musicEl = useRef<HTMLAudioElement>(null);
  const abort = useRef<AbortController | null>(null);
  const list$ = useRef<HTMLOListElement>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  // Preview clock: the time shown, and when playback started (wall clock) if playing.
  const clock = useRef({ t: 0, since: 0 });
  const all = useRef<Item[]>([]);

  const [W, H] = SIZES[size];
  const look: MontageLook = useMemo(() => ({ width: W, height: H, fit, zoom, transition }), [W, H, fit, zoom, transition]);
  const { slots, total } = useMemo(
    () =>
      layout(
        items.map((it) => ({ duration: it.kind === "video" ? it.length : same ? seconds : (it.hold ?? seconds), still: it.kind === "image" })),
        transition,
        trLength,
      ),
    [items, seconds, same, transition, trLength],
  );
  const rendering = render.step === "rendering";
  const pictures = items.filter((i) => i.kind === "image").length;
  const videos = items.length - pictures;

  useEffect(() => {
    all.current = items;
  }, [items]);
  useEffect(() => () => all.current.forEach(free), []);
  useEffect(() => () => void (music && URL.revokeObjectURL(music.url)), [music]);
  useEffect(() => () => void (render.step === "done" && URL.revokeObjectURL(render.url)), [render]);

  // The live preview: draw from the clock, keep each video element (and the music) in step with it.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !items.length) return;
    const m0 = musicEl.current;
    const frame = (i: number): Frame => {
      const it = items[i];
      if (it.bmp) return { src: it.bmp, w: it.w, h: it.h };
      return it.el && it.el.readyState >= 2 ? { src: it.el, w: it.w, h: it.h } : null;
    };
    const sync = (t: number, live: boolean) => {
      items.forEach((it, i) => {
        const el = it.el;
        if (!el) return;
        const s = slots[i];
        if (t < s.start || t >= s.end) {
          if (!el.paused) el.pause();
          return;
        }
        const local = Math.min(t - s.start, it.length - 0.03);
        el.muted = !keepSound;
        if (live) {
          if (el.paused) {
            el.currentTime = local;
            void el.play().catch(() => {});
          } else if (Math.abs(el.currentTime - local) > 0.3) el.currentTime = local;
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - local) > 0.04) el.currentTime = local;
        }
      });
      const m = musicEl.current;
      if (m && isFinite(m.duration) && m.duration > 0) {
        m.volume = musicVolume;
        const at = t % m.duration;
        if (live && t < total) {
          if (m.paused) {
            m.currentTime = at;
            void m.play().catch(() => {});
          } else if (Math.abs(m.currentTime - at) > 0.3) m.currentTime = at;
        } else {
          m.pause();
          m.currentTime = at;
        }
      }
    };
    const show = (t: number) => {
      drawMontage(ctx, t, look, slots, frame);
      if (scrub.current) scrub.current.value = String(t);
      if (clockLabel.current) clockLabel.current.textContent = `${mmss(t)} / ${mmss(total)}`;
    };

    let raf = 0;
    const tick = () => {
      let t = (performance.now() - clock.current.since) / 1000;
      if (t >= total) {
        t = total;
        clock.current.t = t;
        sync(t, false);
        show(Math.max(0, t - 0.001));
        setPlaying(false);
        return;
      }
      clock.current.t = t;
      sync(t, true);
      show(t);
      raf = requestAnimationFrame(tick);
    };
    if (playing) {
      clock.current.since = performance.now() - clock.current.t * 1000;
      raf = requestAnimationFrame(tick);
    } else {
      clock.current.t = Math.min(clock.current.t, total);
      sync(clock.current.t, false);
      show(clock.current.t);
    }
    // Paused on a video: draw again once it has seeked to the right frame.
    const repaint = () => !playing && show(clock.current.t);
    items.forEach((it) => it.el?.addEventListener("seeked", repaint));
    return () => {
      cancelAnimationFrame(raf);
      items.forEach((it) => it.el?.removeEventListener("seeked", repaint));
      if (playing) {
        items.forEach((it) => it.el?.pause());
        m0?.pause();
      }
    };
  }, [items, slots, total, look, playing, keepSound, musicVolume, music, nudge]);

  const seek = (t: number) => {
    clock.current.t = t;
    clock.current.since = performance.now() - t * 1000;
    if (!playing) setNudge((n) => n + 1);
  };

  const add = async (files: File[]) => {
    setError(null);
    setBusy(true);
    try {
      const musicFile = files.find((f) => isMusic(f) && !isVideo(f));
      const media: File[] = [];
      for (const f of files.filter((f) => f.type.startsWith("image/") || isVideo(f) || isZip(f)).sort(naturally)) {
        if (!isZip(f)) {
          media.push(f);
          continue;
        }
        const pics = (await unzip(f))
          .filter((e) => mimeFor(e.name))
          .map((e) => new File([e.blob], `${f.name.replace(/\.zip$/i, "")}/${e.name.split("/").pop()}`, { type: e.blob.type }))
          .sort(naturally);
        if (!pics.length) throw new Error(`"${f.name}" has no images in it.`);
        media.push(...pics);
      }
      if (!media.length && !musicFile) {
        setError("Add pictures (PNG, JPG, WebP, or a ZIP of them), videos (MP4, WebM, MOV), or music (MP3, M4A, WAV).");
        return;
      }
      const loaded: Item[] = [];
      const failed: string[] = [];
      for (const f of media) {
        try {
          loaded.push(isVideo(f) ? await loadVideo(f) : await loadImage(f));
        } catch (e) {
          failed.push(`Couldn't add "${f.name}": ${e instanceof Error ? e.message : String(e)}.`);
        }
      }
      if (loaded.length) setItems((x) => [...x, ...loaded]);
      if (musicFile) {
        const buffer = await decodeSound(musicFile);
        if (buffer) setMusic({ file: musicFile, buffer, url: URL.createObjectURL(musicFile) });
        else failed.push(`Couldn't read the music in "${musicFile.name}".`);
      }
      if (failed.length) setError(failed.join(" "));
      setRender({ step: "idle" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, by: number) =>
    setItems((x) => {
      const j = i + by;
      if (j < 0 || j >= x.length) return x;
      const next = [...x];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  /**
   * Drag a row to a new place. Mouse: grab anywhere on the row except its fields and buttons.
   * Touch: grab the handle, so the list still scrolls with a finger.
   */
  const startDrag = (e: React.PointerEvent<HTMLLIElement>, id: number) => {
    const target = e.target as HTMLElement;
    if (rendering || e.button !== 0 || target.closest("input, .mtg-tools")) return;
    if (e.pointerType !== "mouse" && !target.closest(".mtg-grip")) return;
    const list = list$.current;
    if (!list) return;
    const y0 = e.clientY;
    let active = false;
    let scroll = 0;
    let lastY = y0;
    const place = () => {
      const rows = [...list.children] as HTMLElement[];
      const to = rows.filter((li) => li.dataset.id !== String(id) && li.getBoundingClientRect().top + li.offsetHeight / 2 < lastY).length;
      setItems((x) => {
        const from = x.findIndex((it) => it.id === id);
        if (from < 0 || from === to) return x;
        const next = [...x];
        const [it] = next.splice(from, 1);
        next.splice(to, 0, it);
        return next;
      });
    };
    // Keep scrolling while the pointer rests near the top or bottom edge of the list.
    const edgeScroll = () => {
      const r = list.getBoundingClientRect();
      const step = lastY < r.top + 40 ? -10 : lastY > r.bottom - 40 ? 10 : 0;
      if (step) {
        list.scrollTop += step;
        place();
      }
      scroll = requestAnimationFrame(edgeScroll);
    };
    const move = (ev: PointerEvent) => {
      lastY = ev.clientY;
      if (!active) {
        if (Math.abs(lastY - y0) < 6) return;
        active = true;
        setDragId(id);
        document.body.classList.add("mtg-dragging");
        scroll = requestAnimationFrame(edgeScroll);
      }
      ev.preventDefault();
      place();
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      cancelAnimationFrame(scroll);
      if (!active) return;
      setDragId(null);
      document.body.classList.remove("mtg-dragging");
      // The drop shouldn't also count as a click on the row (which would jump the preview).
      const swallow = (c: MouseEvent) => c.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const remove = (i: number) =>
    setItems((x) => {
      free(x[i]);
      return x.filter((_, k) => k !== i);
    });
  // "Clear all" asks once inline: the first click arms it for a few seconds, the second clears.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  const clearAll = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setPlaying(false);
    items.forEach(free);
    setItems([]);
    clock.current = { t: 0, since: 0 };
    setRender({ step: "idle" });
    setError(null);
  };
  const toggleSame = (on: boolean) => {
    setSame(on);
    // Back to one shared time: drop the separate ones, so unticking again starts from the shared time.
    if (on) setItems((x) => x.map((it) => (it.hold === null ? it : { ...it, hold: null })));
  };
  const sameBox = (
    <label className="check mtg-same">
      <input type="checkbox" checked={same} disabled={rendering} onChange={(e) => toggleSame(e.target.checked)} />
      Same duration for every picture
    </label>
  );
  const setHold = (i: number, v: number) => setItems((x) => x.map((it, k) => (k === i ? { ...it, hold: v } : it)));

  const make = async () => {
    setPlaying(false);
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRender({ step: "rendering", pct: 0 });
    const t0 = performance.now();
    try {
      const audio = await mixAudio(
        slots,
        items.map((it) => (keepSound ? it.sound : null)),
        total,
        music?.buffer ?? null,
        musicVolume,
        transition !== "cut",
      );
      const blob = await renderMontage({
        look,
        fps: FPS,
        items: items.map((it) => (it.bmp ? { kind: "image", bmp: it.bmp } : { kind: "video", file: it.file })),
        slots,
        total,
        audio,
        signal: ctrl.signal,
        onProgress: (pct) => setRender({ step: "rendering", pct }),
      });
      setRender({ step: "done", url: URL.createObjectURL(blob), size: blob.size, seconds: (performance.now() - t0) / 1000 });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(`Couldn't make the video: ${(e as Error).message}`);
      setRender({ step: "idle" });
    }
  };

  const option = (on: boolean, set: (v: boolean) => void, title: string, note: string) => (
    <label className="vid-option">
      <input type="checkbox" checked={on} disabled={rendering} onChange={(e) => set(e.target.checked)} />
      <span>
        <strong>{title}</strong>
        <span className="muted">{note}</span>
      </span>
    </label>
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
            <h1 className="subs-title">Image to video</h1>
            <p className="muted">
              Add pictures and video clips. They play one after another in the order below: each picture for as long as you set,
              each video in full, with a transition in between.
            </p>
          </div>

          <div className="vid-slots">
            <button type="button" className={`vid-slot${items.length ? " filled" : ""}`} disabled={rendering} onClick={async () => add(await pickFile("image/*,video/*,.zip,.mov,.m4v", true))}>
              <ImagePlus size={20} />
              <span>
                <strong>{items.length ? "Add more pictures or videos" : "Pictures and videos"}</strong>
                <span className="muted">
                  {items.length
                    ? `${pictures} picture${pictures === 1 ? "" : "s"}, ${videos} video${videos === 1 ? "" : "s"} · ${mmss(total)}`
                    : "Choose… (ZIPs of pictures work too)"}
                </span>
              </span>
            </button>
            <button type="button" className={`vid-slot${music ? " filled" : ""}`} disabled={rendering} onClick={async () => add(await pickFile("audio/*,.mp3,.m4a,.wav", false))}>
              <Music size={20} />
              <span>
                <strong>Music (optional)</strong>
                <span className="muted">{music ? `${music.file.name} · ${mmss(music.buffer.duration)}` : "Choose…"}</span>
              </span>
            </button>
          </div>
          {busy && <p className="muted">Loading files…</p>}

          <div className="subs-row">
            <label className="field small">
              <span>{same ? "Every picture shows for" : "New pictures show for"}</span>
              <span className="mtg-secs">
                <input
                  type="number"
                  min={0.5}
                  max={60}
                  step={0.5}
                  value={seconds}
                  disabled={rendering}
                  onChange={(e) => setSeconds(Math.min(60, Math.max(0.5, +e.target.value || 2)))}
                />
                s
              </span>
            </label>
            {sameBox}
            <label className="field">
              <span>Transition</span>
              <select value={transition} disabled={rendering} onChange={(e) => setTransition(e.target.value as Transition)}>
                {TRANSITIONS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field small">
              <span>Transition length</span>
              <select value={trLength} disabled={rendering || transition === "cut"} onChange={(e) => setTrLength(+e.target.value)}>
                {LENGTHS.map((s) => (
                  <option key={s} value={s}>
                    {s} s
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Size</span>
              <select value={size} disabled={rendering} onChange={(e) => setSize(e.target.value)}>
                {Object.keys(SIZES).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Fit</span>
              <select value={fit} disabled={rendering} onChange={(e) => setFit(e.target.value as MontageLook["fit"])}>
                <option value="cover">Fill the frame (crop edges)</option>
                <option value="contain">Show the whole picture</option>
              </select>
            </label>
          </div>
          <div className="vid-options">
            {option(zoom, setZoom, "Apply animated zoom", "Zoom each picture between 100% and 105%.")}
            {option(keepSound, setKeepSound, "Keep video sound", "Use each clip's own audio while it plays.")}
            {music && (
              <label className="vid-option">
                <input type="range" min={0} max={1} step={0.05} value={musicVolume} disabled={rendering} onChange={(e) => setMusicVolume(+e.target.value)} />
                <span>
                  <strong>Music volume {Math.round(musicVolume * 100)}%</strong>
                  <span className="muted">
                    Loops if shorter than the video; fades out at the end.{" "}
                    <button type="button" className="link" onClick={() => setMusic(null)}>
                      Remove music
                    </button>
                  </span>
                </span>
              </label>
            )}
          </div>

          {items.length > 0 && (
            <>
              <div className="vid-stage">
                <canvas ref={canvas} width={W} height={H} className={H > W ? "tall" : undefined} style={{ aspectRatio: `${W} / ${H}` }} />
              </div>
              <div className="mtg-transport">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={rendering}
                  aria-label={playing ? "Pause preview" : "Play preview"}
                  onClick={() => {
                    if (!playing && clock.current.t >= total - 0.05) clock.current.t = 0;
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <input ref={scrub} type="range" min={0} max={total} step={0.01} defaultValue={0} aria-label="Preview position" onChange={(e) => seek(+e.target.value)} />
                <span ref={clockLabel} className="num muted" />
              </div>

              <div className="mtg-listhead">
                <span>
                  <strong>Clips</strong>{" "}
                  <span className="muted">
                    {pictures} picture{pictures === 1 ? "" : "s"}, {videos} video{videos === 1 ? "" : "s"}
                  </span>
                </span>
                {pictures > 0 && sameBox}
                <button type="button" className={`btn ghost${armed ? " danger" : ""}`} disabled={rendering} onClick={clearAll}>
                  <RotateCcw size={16} />
                  {armed ? "Click again to clear all" : "Clear all"}
                </button>
              </div>
              <ol ref={list$} className="mtg-list" aria-label="Clips in order. Drag a row to move it.">
                {items.map((it, i) => (
                  <li key={it.id} data-id={it.id} className={dragId === it.id ? "dragging" : undefined} onPointerDown={(e) => startDrag(e, it.id)}>
                    <span className="mtg-grip" title="Drag to reorder" aria-hidden="true">
                      <GripVertical size={16} />
                      <span className="num">{i + 1}</span>
                    </span>
                    {it.kind === "image" ? <img src={it.url} alt="" /> : <video src={`${it.url}#t=0.1`} muted preload="metadata" />}
                    <button type="button" className="mtg-name" onClick={() => seek(slots[i].start)} title="Jump to this clip in the preview">
                      <strong>{it.file.name}</strong>
                      <span className="muted">
                        {it.kind === "video" ? <Video size={13} /> : null} starts {mmss(slots[i].start)}
                        {it.kind === "video" && !it.sound ? " · no sound" : ""}
                      </span>
                    </button>
                    {it.kind === "image" ? (
                      <label className="mtg-secs" title={same ? "Changes every picture (same duration is on)" : "How long this picture shows"}>
                        <input
                          type="number"
                          min={0.5}
                          max={60}
                          step={0.5}
                          value={same ? seconds : (it.hold ?? seconds)}
                          disabled={rendering}
                          aria-label={`Seconds for ${it.file.name}`}
                          onChange={(e) => {
                            const v = Math.min(60, Math.max(0.5, +e.target.value || seconds));
                            if (same) setSeconds(v);
                            else setHold(i, v);
                          }}
                        />
                        s
                      </label>
                    ) : (
                      <span className="mtg-secs num muted" title="Videos play in full">
                        {it.length.toFixed(1)} s
                      </span>
                    )}
                    <span className="mtg-tools">
                      <button type="button" className="icon-btn" disabled={rendering || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                        <ArrowUp size={15} />
                      </button>
                      <button type="button" className="icon-btn" disabled={rendering || i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                        <ArrowDown size={15} />
                      </button>
                      <button type="button" className="icon-btn" disabled={rendering} onClick={() => remove(i)} aria-label={`Remove ${it.file.name}`}>
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="fine left">
                {items.length} clip{items.length === 1 ? "" : "s"}, {mmss(total)} in all.
                {transition !== "cut" && transition !== "black" && items.length > 1 && " Each transition overlaps the two clips it joins."}
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
                    {W} × {H}, {mmss(total)}, {(render.size / 1e6).toFixed(1)} MB · made in {render.seconds.toFixed(0)} s
                  </p>
                  <div className="welcome-actions left">
                    <a className="btn primary lg" href={render.url} download="image-to-video.mp4">
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
          {!items.length && <p className="fine left">Everything is processed on this computer; nothing is uploaded.</p>}
        </div>
      </div>
      {music && <audio ref={musicEl} src={music.url} preload="auto" hidden />}
    </main>
  );
}
