import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type WrappedCanvas,
} from "mediabunny";

export type Transition = "cut" | "fade" | "black" | "slide" | "wipe" | "zoom";

export const TRANSITIONS: [Transition, string][] = [
  ["fade", "Crossfade"],
  ["black", "Fade through black"],
  ["slide", "Slide"],
  ["wipe", "Wipe"],
  ["zoom", "Zoom in"],
  ["cut", "None (hard cut)"],
];

export interface MontageLook {
  width: number;
  height: number;
  fit: "cover" | "contain";
  zoom: boolean; // slow 100% → 105% push on pictures
  transition: Transition;
}

/** Where one item sits on the timeline. `trIn`/`trOut` are the transitions shared with its neighbours. */
export interface Slot {
  start: number;
  end: number;
  trIn: number;
  trOut: number;
  still: boolean; // a picture (gets the slow zoom), not a video
}

export type Frame = { src: CanvasImageSource; w: number; h: number } | null;

const ZOOM = 0.05;
const overlaps = (t: Transition) => t !== "cut" && t !== "black";

/**
 * Lay items end to end. Overlapping transitions (crossfade, slide, wipe, zoom) start the next item while the last
 * is still finishing, so they shorten the total; a fade through black and a cut don't.
 */
export function layout(items: { duration: number; still: boolean }[], transition: Transition, length: number) {
  const slots: Slot[] = [];
  let t = 0;
  items.forEach((it, i) => {
    const next = items[i + 1];
    const tr = transition === "cut" || !next ? 0 : Math.min(length, it.duration / 2, next.duration / 2);
    const trIn = slots.length ? slots[slots.length - 1].trOut : 0;
    slots.push({ start: t, end: t + it.duration, trIn, trOut: tr, still: it.still });
    t += it.duration - (overlaps(transition) ? tr : 0);
  });
  const total = slots.length ? slots[slots.length - 1].end : 0;
  return { slots, total };
}

/** Indexes of the items on screen at `t`: one, or two during an overlapping transition. */
export function activeAt(slots: Slot[], t: number): number[] {
  const on: number[] = [];
  slots.forEach((s, i) => {
    if (t >= s.start && t < s.end) on.push(i);
  });
  if (!on.length && slots.length) on.push(t < 0 ? 0 : slots.length - 1);
  return on;
}

function place(ctx: CanvasRenderingContext2D, f: NonNullable<Frame>, look: MontageLook, scale: number, alpha: number, dx = 0) {
  const { width: W, height: H } = look;
  const cover = Math.max(W / f.w, H / f.h);
  ctx.globalAlpha = alpha;
  if (look.fit === "contain") {
    // Blurred fill behind letterboxed pictures instead of black bars.
    const k = cover * 1.1;
    ctx.filter = "blur(40px) brightness(0.55)";
    ctx.drawImage(f.src, dx + (W - f.w * k) / 2, (H - f.h * k) / 2, f.w * k, f.h * k);
    ctx.filter = "none";
  }
  const k = (look.fit === "cover" ? cover : Math.min(W / f.w, H / f.h)) * scale;
  ctx.drawImage(f.src, dx + (W - f.w * k) / 2, (H - f.h * k) / 2, f.w * k, f.h * k);
  ctx.globalAlpha = 1;
}

/** Paint the frame at time `t`. Shared by the live preview and the encoder, so they match. */
export function drawMontage(ctx: CanvasRenderingContext2D, t: number, look: MontageLook, slots: Slot[], frame: (i: number) => Frame) {
  const { width: W, height: H } = look;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const on = activeAt(slots, t);
  const push = (i: number) => {
    const s = slots[i];
    return look.zoom && s.still ? 1 + ZOOM * Math.min(1, Math.max(0, (t - s.start) / Math.max(0.001, s.end - s.start))) : 1;
  };
  const draw = (i: number, scale = 1, alpha = 1, dx = 0) => {
    const f = frame(i);
    if (f) place(ctx, f, look, push(i) * scale, alpha, dx);
  };

  if (on.length === 1) {
    const i = on[0];
    const s = slots[i];
    let alpha = 1;
    if (look.transition === "black") {
      if (s.trIn) alpha = Math.min(alpha, (t - s.start) / (s.trIn / 2));
      if (s.trOut) alpha = Math.min(alpha, (s.end - t) / (s.trOut / 2));
    }
    draw(i, 1, Math.max(0, Math.min(1, alpha)));
    return;
  }

  const [a, b] = on;
  const p = Math.max(0, Math.min(1, (t - slots[b].start) / Math.max(0.001, slots[b].trIn)));
  const ease = p * p * (3 - 2 * p);
  switch (look.transition) {
    case "slide":
      draw(a, 1, 1, -ease * W);
      draw(b, 1, 1, (1 - ease) * W);
      break;
    case "wipe":
      draw(a);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, ease * W, H);
      ctx.clip();
      draw(b);
      ctx.restore();
      break;
    case "zoom":
      draw(a, 1 + 0.25 * ease, 1);
      draw(b, 1.08 - 0.08 * ease, ease);
      break;
    default:
      draw(a);
      draw(b, 1, p);
  }
}

export type RenderItem = { kind: "image"; bmp: ImageBitmap } | { kind: "video"; file: File };

/**
 * Build the soundtrack: each video's own sound where it plays (faded across transitions), plus optional music
 * looped under everything and faded out at the end.
 */
export async function mixAudio(
  slots: Slot[],
  sounds: (AudioBuffer | null)[],
  total: number,
  music: AudioBuffer | null,
  musicVolume: number,
  fadeSound: boolean,
): Promise<AudioBuffer | null> {
  if (!music && !sounds.some(Boolean)) return null;
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * rate)), rate);
  sounds.forEach((buf, i) => {
    if (!buf) return;
    const s = slots[i];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const len = s.end - s.start;
    if (fadeSound && s.trIn) {
      g.gain.setValueAtTime(0, s.start);
      g.gain.linearRampToValueAtTime(1, s.start + s.trIn);
    }
    if (fadeSound && s.trOut) {
      g.gain.setValueAtTime(1, s.end - s.trOut);
      g.gain.linearRampToValueAtTime(0, s.end);
    }
    src.connect(g).connect(ctx.destination);
    src.start(s.start, 0, Math.min(len, buf.duration));
  });
  if (music) {
    const src = ctx.createBufferSource();
    src.buffer = music;
    src.loop = music.duration < total;
    const g = ctx.createGain();
    const fade = Math.min(2, total / 4);
    g.gain.setValueAtTime(musicVolume, 0);
    g.gain.setValueAtTime(musicVolume, Math.max(0, total - fade));
    g.gain.linearRampToValueAtTime(0, total);
    src.connect(g).connect(ctx.destination);
    src.start(0);
  }
  return ctx.startRendering();
}

/** Reads one video's frames in order, holding the current one until a later frame is due. */
class VideoReader {
  private input: Input;
  private it: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private cur: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private done = false;
  private first = 0;

  constructor(
    private file: File,
    private maxW: number,
    private maxH: number,
  ) {
    this.input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  }

  async frameAt(local: number): Promise<Frame> {
    if (!this.it) {
      const track = await this.input.getPrimaryVideoTrack();
      if (!track) throw new Error(`"${this.file.name}" has no video track.`);
      if (!(await track.canDecode())) throw new Error(`This browser can't decode "${this.file.name}".`);
      this.first = await track.getFirstTimestamp();
      // No need to decode more pixels than the output frame can show.
      const k = Math.min(1, Math.max(this.maxW / track.displayWidth, this.maxH / track.displayHeight) * 1.06);
      const sink = new CanvasSink(track, { width: Math.round(track.displayWidth * k), height: Math.round(track.displayHeight * k), fit: "fill" });
      this.it = sink.canvases();
      const r = await this.it.next();
      this.cur = r.done ? null : r.value;
      const n = await this.it.next();
      this.next = n.done ? null : n.value;
      this.done = !this.next;
    }
    const at = this.first + local;
    while (!this.done && this.next && this.next.timestamp <= at) {
      this.cur = this.next;
      const r = await this.it.next();
      this.next = r.done ? null : r.value;
      this.done = !this.next;
    }
    const c = this.cur?.canvas;
    return c ? { src: c as CanvasImageSource, w: c.width, h: c.height } : null;
  }

  async close() {
    await this.it?.return();
    this.input.dispose();
  }
}

export interface MontageJob {
  look: MontageLook;
  fps: number;
  items: RenderItem[];
  slots: Slot[];
  total: number;
  audio: AudioBuffer | null;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

export async function renderMontage(job: MontageJob): Promise<Blob> {
  const { look, fps, total, slots, items } = job;
  const videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: look.width, height: look.height });
  if (!videoCodec) throw new Error("This browser can't encode video. Try the latest Chrome or Edge.");
  const audioCodec = job.audio
    ? await getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: job.audio.numberOfChannels, sampleRate: job.audio.sampleRate })
    : null;
  if (job.audio && !audioCodec) throw new Error("This browser can't encode audio. Try the latest Chrome or Edge.");

  const canvas = document.createElement("canvas");
  canvas.width = look.width;
  canvas.height = look.height;
  const ctx = canvas.getContext("2d")!;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const readers = new Map<number, VideoReader>();
  const frames = new Map<number, Frame>();
  try {
    if (audio && job.audio) await audio.add(job.audio);
    const count = Math.ceil(total * fps);
    for (let n = 0; n < count; n++) {
      if (job.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const t = n / fps;
      const on = activeAt(slots, t);
      frames.clear();
      for (const i of on) {
        const it = items[i];
        if (it.kind === "image") {
          frames.set(i, { src: it.bmp, w: it.bmp.width, h: it.bmp.height });
          continue;
        }
        let r = readers.get(i);
        if (!r) readers.set(i, (r = new VideoReader(it.file, look.width, look.height)));
        frames.set(i, await r.frameAt(Math.max(0, t - slots[i].start)));
      }
      // Videos that have finished playing can let go of their decoder.
      for (const [i, r] of readers) {
        if (slots[i].end <= t) {
          readers.delete(i);
          await r.close();
        }
      }
      drawMontage(ctx, t, look, slots, (i) => frames.get(i) ?? null);
      await video.add(t, 1 / fps);
      if (n % 15 === 0) {
        job.onProgress(n / count);
        await new Promise((r) => setTimeout(r)); // let the page repaint
      }
    }
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  } finally {
    for (const r of readers.values()) await r.close().catch(() => {});
  }
  job.onProgress(1);
  return new Blob([output.target.buffer!], { type: "video/mp4" });
}
