import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from "mediabunny";
import type { Cue } from "./srt";

export interface Look {
  width: number;
  height: number;
  fit: "cover" | "contain";
  captions: boolean;
  captionSize: number; // fraction of frame height
  zoom: boolean;
  fade: boolean;
}

/** A stretch of time showing one image. */
export interface Segment {
  start: number;
  end: number;
  image: number;
}

const FADE = 0.5;
const ZOOM = 0.05; // 100% → 105% over each image

/** A short, soft click: a 2.4 kHz tick plus a little noise, decaying in ~35 ms. */
export function makeClick(sampleRate: number): Float32Array {
  const n = Math.round(sampleRate * 0.04);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t / 0.008);
    out[i] = 0.45 * env * (0.7 * Math.sin(2 * Math.PI * 2400 * t) + 0.3 * (Math.random() * 2 - 1));
  }
  return out;
}

/** The soundtrack with a click mixed in at each time, extended with silence to `duration` if needed. */
export function withClicks(audio: AudioBuffer, times: number[], duration: number): AudioBuffer {
  const rate = audio.sampleRate;
  const out = new AudioBuffer({
    length: Math.max(audio.length, Math.ceil(duration * rate)),
    numberOfChannels: audio.numberOfChannels,
    sampleRate: rate,
  });
  const click = makeClick(rate);
  for (let ch = 0; ch < audio.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    data.set(audio.getChannelData(ch));
    for (const t of times) {
      const at = Math.round(t * rate);
      for (let i = 0; i < click.length && at + i < data.length; i++) {
        data[at + i] = Math.max(-1, Math.min(1, data[at + i] + click[i]));
      }
    }
  }
  return out;
}

/**
 * One image per cue (by `assign`), held until the next cue with a different image.
 * The first image shows from 0 and the last runs to the end, so the screen is never blank.
 */
export function buildSegments(cues: Cue[], assign: number[], duration: number): Segment[] {
  const segs: Segment[] = [];
  cues.forEach((c, i) => {
    const img = assign[i] ?? 0;
    if (segs.length && segs[segs.length - 1].image === img) return;
    if (segs.length) segs[segs.length - 1].end = c.start;
    segs.push({ start: segs.length ? c.start : 0, end: duration, image: img });
  });
  if (!segs.length) segs.push({ start: 0, end: duration, image: 0 });
  return segs;
}

/** Spread images evenly over the cues: 1:1 when the counts match, groups of cues per image otherwise. */
export function defaultAssign(cues: number, images: number): number[] {
  if (!images) return Array(cues).fill(0);
  return Array.from({ length: cues }, (_, i) => Math.min(images - 1, Math.floor((i * images) / cues)));
}

function drawImage(ctx: CanvasRenderingContext2D, img: ImageBitmap, look: Look, scale: number, alpha: number) {
  const { width: W, height: H } = look;
  const cover = Math.max(W / img.width, H / img.height);
  const fitK = look.fit === "cover" ? cover : Math.min(W / img.width, H / img.height);
  ctx.globalAlpha = alpha;
  if (look.fit === "contain") {
    // Blurred fill behind letterboxed images instead of black bars.
    const k = cover * 1.1;
    ctx.filter = "blur(40px) brightness(0.55)";
    ctx.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
    ctx.filter = "none";
  }
  const k = fitK * scale;
  ctx.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
  ctx.globalAlpha = 1;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(next).width > max) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, look: Look) {
  const { width: W, height: H } = look;
  const size = Math.round(H * look.captionSize);
  ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const lines = wrapLines(ctx, text, W * 0.86);
  const lh = size * 1.25;
  let y = H - H * 0.07 - (lines.length - 1) * lh;
  for (const l of lines) {
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(l, W / 2, y);
    ctx.fillStyle = "#fff";
    ctx.fillText(l, W / 2, y);
    y += lh;
  }
}

/** Paint the frame at time `t`. Used by both the live preview and the encoder, so they always match. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  t: number,
  look: Look,
  segs: Segment[],
  cues: Cue[],
  images: ImageBitmap[],
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, look.width, look.height);
  if (images.length) {
    let s = segs.findIndex((g) => t >= g.start && t < g.end);
    if (s < 0) s = t < segs[0].start ? 0 : segs.length - 1;
    const seg = segs[s];
    const zoomAt = (g: Segment) => (look.zoom ? 1 + ZOOM * Math.min(1, Math.max(0, (t - g.start) / Math.max(0.001, g.end - g.start))) : 1);
    const into = t - seg.start;
    if (look.fade && s > 0 && into < FADE) {
      const prev = segs[s - 1];
      drawImage(ctx, images[prev.image], look, zoomAt(prev), 1);
      drawImage(ctx, images[seg.image], look, zoomAt(seg), into / FADE);
    } else {
      drawImage(ctx, images[seg.image], look, zoomAt(seg), 1);
    }
  }
  if (look.captions) {
    const cue = cues.find((c) => t >= c.start && t < c.end);
    if (cue) drawCaption(ctx, cue.text, look);
  }
}

export interface RenderJob {
  look: Look;
  fps: number;
  cues: Cue[];
  segs: Segment[];
  images: ImageBitmap[];
  audio: AudioBuffer;
  /** Mix a click in whenever a new image starts. */
  clickOnChange: boolean;
  duration: number;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

export async function renderVideo(job: RenderJob): Promise<Blob> {
  const { look, fps, duration } = job;
  const videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: look.width, height: look.height });
  const audioCodec = await getFirstEncodableAudioCodec(["aac", "opus"], {
    numberOfChannels: job.audio.numberOfChannels,
    sampleRate: job.audio.sampleRate,
  });
  if (!videoCodec) throw new Error("This browser can't encode video. Try the latest Chrome or Edge.");
  if (!audioCodec) throw new Error("This browser can't encode audio. Try the latest Chrome or Edge.");

  const canvas = document.createElement("canvas");
  canvas.width = look.width;
  canvas.height = look.height;
  const ctx = canvas.getContext("2d")!;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(audio);
  await output.start();

  try {
    // The first image is there from the start, so only later changes click.
    await audio.add(job.clickOnChange ? withClicks(job.audio, job.segs.slice(1).map((s) => s.start), duration) : job.audio);
    const frames = Math.ceil(duration * fps);
    for (let i = 0; i < frames; i++) {
      if (job.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      drawFrame(ctx, i / fps, look, job.segs, job.cues, job.images);
      await video.add(i / fps, 1 / fps);
      if (i % 15 === 0) {
        job.onProgress(i / frames);
        await new Promise((r) => setTimeout(r)); // let the page repaint
      }
    }
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  }
  job.onProgress(1);
  return new Blob([output.target.buffer!], { type: "video/mp4" });
}
