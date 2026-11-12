export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** Whisper chunk as returned with `return_timestamps: true`. End is null when the audio stops mid-segment. */
export interface Segment {
  timestamp: [number, number | null];
  text: string;
}

const MAX_CHARS = 84; // two lines of ~42, the common broadcast limit
const MAX_SECONDS = 7;

/**
 * Turn Whisper segments into readable cues: drop empties, close open ends,
 * and split long segments at word boundaries with time shared by character count.
 */
export function toCues(segments: Segment[], duration: number): Cue[] {
  const cues: Cue[] = [];
  segments.forEach((seg, i) => {
    const text = seg.text.replace(/\s+/g, " ").trim();
    if (!text) return;
    const start = Math.max(0, seg.timestamp[0] ?? 0);
    const next = segments[i + 1]?.timestamp[0];
    // An open end can span minutes of trailing silence; hold the cue only as long as it takes to read.
    let end = seg.timestamp[1] ?? Math.min(next ?? duration, start + Math.max(2, text.length / 12 + 1));
    if (!(end > start)) end = Math.min(duration, start + 2);

    // Split by length, and by time only as far as the text could plausibly be spoken (pauses don't need cues).
    const spoken = Math.min(end - start, text.length / 6);
    const parts = splitText(text, Math.max(Math.ceil(text.length / MAX_CHARS), Math.ceil(spoken / MAX_SECONDS)));
    const total = parts.reduce((n, p) => n + p.length, 0);
    let t = start;
    for (const p of parts) {
      const d = ((end - start) * p.length) / total;
      cues.push({ start: t, end: t + d, text: wrap(p) });
      t += d;
    }
  });
  return cues;
}

/** Split into `n` pieces of similar length, preferring sentence and clause breaks. */
function splitText(text: string, n: number): string[] {
  if (n <= 1) return [text];
  const words = text.split(" ");
  if (words.length <= n) return words;
  const target = text.length / n;
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    const len = cur.join(" ").length;
    const breaks = /[.!?,;:]$/.test(w);
    if (out.length < n - 1 && (len >= target * 1.15 || (breaks && len >= target * 0.6))) {
      out.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

/** Break a cue into at most two balanced lines. */
function wrap(text: string): string {
  if (text.length <= 42) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

export function timecode(sec: number, sep = ","): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (v: number, l = 2) => String(v).padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${timecode(c.start)} --> ${timecode(c.end)}\n${c.text}\n`).join("\n");
}

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${timecode(c.start, ".")} --> ${timecode(c.end, ".")}\n${c.text}\n`).join("\n")}`;
}

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const toSec = (m: RegExpMatchArray) => +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, "0") / 1000;

/** Parse SRT (also accepts WebVTT-style timings). Formatting tags are stripped; line breaks are kept. */
export function parseSrt(src: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of (src.charCodeAt(0) === 0xfeff ? src.slice(1) : src).replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const s = a.match(TIME);
    const e = b?.match(TIME);
    if (!s || !e) continue;
    const text = lines
      .slice(at + 1)
      .join("\n")
      .replace(/<[^>]+>|\{\\[^}]*\}/g, "")
      .trim();
    if (text) cues.push({ start: toSec(s), end: toSec(e), text });
  }
  return cues.sort((x, y) => x.start - y.start);
}
