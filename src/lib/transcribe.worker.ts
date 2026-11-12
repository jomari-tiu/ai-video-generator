/// <reference lib="webworker" />
import { pipeline, WhisperTextStreamer, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type ModelSize = "tiny" | "base" | "small";

export type WorkerIn = {
  type: "run";
  audio: Float32Array;
  model: ModelSize;
  language: string | null;
  translate: boolean;
};

export type WorkerOut =
  | { type: "download"; loaded: number; total: number }
  | { type: "progress"; done: number; total: number; text: string }
  | { type: "result"; chunks: { timestamp: [number, number | null]; text: string }[]; device: string }
  | { type: "error"; message: string };

const post = (m: WorkerOut) => self.postMessage(m);

const CHUNK_S = 30;
const STRIDE_S = 5;

let cached: { key: string; asr: AutomaticSpeechRecognitionPipeline; device: string } | null = null;

async function load(model: ModelSize) {
  if (cached?.key === model) return cached;
  cached = null;
  const id = `onnx-community/whisper-${model}`;

  // Sum bytes across every model file so the bar moves once, not per file.
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: "download", loaded, total });
  };

  const gpu = "gpu" in navigator && (await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  if (gpu) {
    try {
      const asr = await pipeline("automatic-speech-recognition", id, {
        device: "webgpu",
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        progress_callback,
      });
      cached = { key: model, asr, device: "GPU" };
      return cached;
    } catch {
      files.clear(); // fall through to CPU
    }
  }
  const asr = await pipeline("automatic-speech-recognition", id, { device: "wasm", dtype: "q8", progress_callback });
  cached = { key: model, asr, device: "CPU" };
  return cached;
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const { audio, model, language, translate } = e.data;
  try {
    const { asr, device } = await load(model);

    // Mirror the pipeline's chunking so we know how many windows to expect.
    const win = CHUNK_S * 16_000;
    const jump = (CHUNK_S - 2 * STRIDE_S) * 16_000;
    let total = 1;
    for (let off = 0; off + win < audio.length; off += jump) total++;

    let done = 0;
    let text = "";
    post({ type: "progress", done, total, text });
    const streamer = new WhisperTextStreamer(asr.tokenizer as ConstructorParameters<typeof WhisperTextStreamer>[0], {
      skip_prompt: true,
      callback_function: (t: string) => {
        text = (text + t).slice(-400);
        post({ type: "progress", done, total, text });
      },
      on_finalize: () => {
        done = Math.min(total, done + 1);
        post({ type: "progress", done, total, text });
      },
    });

    const out = await asr(audio, {
      return_timestamps: true,
      chunk_length_s: CHUNK_S,
      stride_length_s: STRIDE_S,
      language: language ?? undefined,
      task: translate ? "translate" : "transcribe",
      streamer,
    });
    const res = Array.isArray(out) ? out[0] : out;
    post({ type: "result", chunks: (res.chunks ?? []) as { timestamp: [number, number | null]; text: string }[], device });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
