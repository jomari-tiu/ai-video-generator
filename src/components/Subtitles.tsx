import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, RotateCcw, Upload, X } from "lucide-react";
import { pickFile } from "@/lib/images";
import { decodeAudio, SAMPLE_RATE } from "@/lib/media";
import { timecode, toCues, toSrt, toVtt, type Cue } from "@/lib/srt";
import type { ModelSize, WorkerIn, WorkerOut } from "@/lib/transcribe.worker";

const ACCEPT = "audio/mpeg,video/mp4,audio/mp4,.mp3,.mp4,.m4a";

const MODELS: { id: ModelSize; label: string; note: string }[] = [
  { id: "tiny", label: "Fast", note: "≈40 MB download, rougher text" },
  { id: "base", label: "Balanced", note: "≈80 MB download" },
  { id: "small", label: "Accurate", note: "≈250 MB download, slower" },
];

const LANGUAGES: [string, string][] = [
  ["", "Detect automatically"],
  ["english", "English"],
  ["tagalog", "Filipino / Tagalog"],
  ["spanish", "Spanish"],
  ["french", "French"],
  ["german", "German"],
  ["portuguese", "Portuguese"],
  ["italian", "Italian"],
  ["japanese", "Japanese"],
  ["korean", "Korean"],
  ["chinese", "Chinese"],
  ["indonesian", "Indonesian"],
  ["hindi", "Hindi"],
  ["arabic", "Arabic"],
  ["russian", "Russian"],
];

type Phase =
  | { step: "idle" }
  | { step: "decoding" }
  | { step: "download"; loaded: number; total: number }
  | { step: "transcribing"; done: number; total: number; text: string }
  | { step: "done"; cues: Cue[]; device: string };

const mb = (b: number) => `${(b / 1e6).toFixed(0)} MB`;

function save(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Subtitles() {
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState<ModelSize>("base");
  const [language, setLanguage] = useState("");
  const [translate, setTranslate] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const worker = useRef<Worker | null>(null);
  const player = useRef<HTMLMediaElement | null>(null);
  const [now, setNow] = useState(-1);
  const [view, setView] = useState<"list" | "srt">("list");
  const [copied, setCopied] = useState(false);
  const seek = (t: number) => {
    if (!player.current) return;
    player.current.currentTime = t;
    void player.current.play();
  };

  useEffect(() => () => worker.current?.terminate(), []);

  const mediaUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (mediaUrl && URL.revokeObjectURL(mediaUrl)), [mediaUrl]);

  const cues = phase.step === "done" ? phase.cues : null;
  const vttUrl = useMemo(() => (cues ? URL.createObjectURL(new Blob([toVtt(cues)], { type: "text/vtt" })) : null), [cues]);
  useEffect(() => () => void (vttUrl && URL.revokeObjectURL(vttUrl)), [vttUrl]);

  const busy = phase.step !== "idle" && phase.step !== "done";
  const base = file?.name.replace(/\.[^.]+$/, "") ?? "subtitles";

  const choose = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!/^(audio|video)\//.test(f.type) && !/\.(mp3|mp4|m4a)$/i.test(f.name)) {
      setError("That isn't an MP3 or MP4 file.");
      return;
    }
    setError(null);
    setFile(f);
    setPhase({ step: "idle" });
  };

  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    setPhase({ step: "idle" });
  };

  const run = async () => {
    if (!file) return;
    setError(null);
    setPhase({ step: "decoding" });
    let audio: Float32Array;
    try {
      audio = await decodeAudio(file);
    } catch (e) {
      setError((e as Error).message);
      setPhase({ step: "idle" });
      return;
    }
    const duration = audio.length / SAMPLE_RATE;

    // Reuse the worker so a downloaded model stays in memory between runs.
    const w = (worker.current ??= new Worker(new URL("../lib/transcribe.worker.ts", import.meta.url), { type: "module" }));
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "download") setPhase({ step: "download", loaded: m.loaded, total: m.total });
      else if (m.type === "progress") setPhase({ step: "transcribing", done: m.done, total: m.total, text: m.text });
      else if (m.type === "result") {
        const cues = toCues(m.chunks, duration);
        if (!cues.length) setError("No speech was found in this file.");
        setPhase(cues.length ? { step: "done", cues, device: m.device } : { step: "idle" });
      } else {
        setError(`Transcription failed: ${m.message}`);
        setPhase({ step: "idle" });
      }
    };
    w.onerror = (e) => {
      setError(`Transcription failed: ${e.message}`);
      setPhase({ step: "idle" });
    };
    const msg: WorkerIn = { type: "run", audio, model, language: language || null, translate };
    w.postMessage(msg, [audio.buffer]);
  };

  const pct =
    phase.step === "download"
      ? phase.total
        ? phase.loaded / phase.total
        : 0
      : phase.step === "transcribing"
        ? phase.done / phase.total
        : null;

  return (
    <main className="welcome">
      <div
        className={`dropzone subs${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) choose(Array.from(e.dataTransfer.files));
        }}
      >
        {!file ? (
          <>
            <div className="reel" aria-hidden="true">
              <span />
              <span className="mark" />
            </div>
            <h1>Make subtitles</h1>
            <p className="lede">Upload an MP3 or MP4 and get a timestamped SRT file, transcribed right here in your browser.</p>
            <div className="welcome-actions">
              <button type="button" className="btn primary lg" onClick={async () => choose(await pickFile(ACCEPT))}>
                <Upload size={18} />
                Choose MP3 or MP4
              </button>
            </div>
            <p className="fine">
              Or drop a file here. The speech model downloads once and is cached; your audio stays on this computer.
            </p>
          </>
        ) : (
          <div className="subs-body">
            <div className="subs-file">
              <div>
                <h1 className="subs-title">{file.name}</h1>
                <p className="muted num">{mb(file.size)}</p>
              </div>
              {!busy && (
                <button type="button" className="btn ghost" onClick={() => (setFile(null), setPhase({ step: "idle" }))}>
                  <RotateCcw size={16} />
                  Different file
                </button>
              )}
            </div>

            {phase.step === "done" && mediaUrl ? (
              <>
                {/^video\//.test(file.type) || /\.mp4$/i.test(file.name) ? (
                  <video
                    ref={(el) => void (player.current = el)}
                    className="subs-media"
                    src={mediaUrl}
                    controls
                    onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                  >
                    {vttUrl && <track kind="subtitles" src={vttUrl} srcLang="und" label="Generated" default />}
                  </video>
                ) : (
                  <audio
                    ref={(el) => void (player.current = el)}
                    className="subs-media"
                    src={mediaUrl}
                    controls
                    onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                  />
                )}
                <div className="subs-tabs" role="tablist" aria-label="Preview">
                  <button type="button" role="tab" aria-selected={view === "list"} onClick={() => setView("list")}>
                    Subtitles
                  </button>
                  <button type="button" role="tab" aria-selected={view === "srt"} onClick={() => setView("srt")}>
                    SRT file
                  </button>
                  {view === "srt" && (
                    <button
                      type="button"
                      className="btn ghost subs-copy"
                      onClick={async () => {
                        await navigator.clipboard.writeText(toSrt(phase.cues));
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  )}
                </div>
                {view === "srt" ? (
                  <pre className="srt-preview" aria-label={`${base}.srt`}>
                    {phase.cues.map((c, i) => (
                      <span
                        key={i}
                        className={now >= c.start && now < c.end ? "on" : undefined}
                        onClick={() => seek(c.start)}
                      >
                        <span className="srt-idx">{i + 1}</span>
                        {"\n"}
                        <span className="srt-time">
                          {timecode(c.start)} --&gt; {timecode(c.end)}
                        </span>
                        {`\n${c.text}\n\n`}
                      </span>
                    ))}
                  </pre>
                ) : (
                <ol className="cue-list" aria-label="Subtitles">
                  {phase.cues.map((c, i) => (
                    <li
                      key={i}
                      className={now >= c.start && now < c.end ? "on" : undefined}
                      onClick={() => seek(c.start)}
                    >
                      <span className="num muted">{timecode(c.start).slice(0, 8)}</span>
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ol>
                )}
                <p className="fine left">
                  {phase.cues.length} subtitles · transcribed on {phase.device}. Machine transcription: check names and
                  numbers before publishing.
                </p>
                <div className="welcome-actions left">
                  <button type="button" className="btn primary lg" onClick={() => save(toSrt(phase.cues), `${base}.srt`, "application/x-subrip")}>
                    <Download size={18} />
                    Download SRT
                  </button>
                  <button type="button" className="btn ghost lg" onClick={() => save(toVtt(phase.cues), `${base}.vtt`, "text/vtt")}>
                    Download VTT
                  </button>
                  <button type="button" className="btn ghost lg" onClick={() => setPhase({ step: "idle" })}>
                    Change settings
                  </button>
                </div>
              </>
            ) : (
              <>
                <fieldset className="subs-options" disabled={busy}>
                  <legend>Quality</legend>
                  <div className="seg">
                    {MODELS.map((m) => (
                      <label key={m.id} className={model === m.id ? "on" : ""}>
                        <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)} />
                        <strong>{m.label}</strong>
                        <span className="muted">{m.note}</span>
                      </label>
                    ))}
                  </div>
                  <div className="subs-row">
                    <label className="field">
                      <span>Spoken language</span>
                      <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                        {LANGUAGES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} />
                      Translate subtitles to English
                    </label>
                  </div>
                </fieldset>

                {busy ? (
                  <div className="subs-progress" role="status">
                    <div className="subs-progress-head">
                      <span>
                        {phase.step === "decoding" && "Reading audio…"}
                        {phase.step === "download" &&
                          `Downloading speech model… ${phase.total ? `${mb(phase.loaded)} of ${mb(phase.total)}` : ""}`}
                        {phase.step === "transcribing" && `Transcribing… part ${Math.min(phase.done + 1, phase.total)} of ${phase.total}`}
                      </span>
                      <button type="button" className="btn ghost" onClick={cancel}>
                        <X size={16} />
                        Cancel
                      </button>
                    </div>
                    <div className={`bar${pct === null ? " indeterminate" : ""}`}>
                      <span style={{ width: `${((pct ?? 0) * 100).toFixed(1)}%` }} />
                    </div>
                    {phase.step === "transcribing" && phase.text && <p className="subs-live">{phase.text}</p>}
                  </div>
                ) : (
                  <div className="welcome-actions left">
                    <button type="button" className="btn primary lg" onClick={run}>
                      Generate subtitles
                    </button>
                  </div>
                )}
              </>
            )}
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
