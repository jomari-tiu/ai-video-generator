export const SAMPLE_RATE = 16_000; // what Whisper expects

/**
 * Decode the audio track of an MP3/MP4 (or any format the browser plays) to
 * 16 kHz mono samples. Decoding happens locally; nothing is uploaded.
 */
export async function decodeAudio(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const audio = await ctx.decodeAudioData(buf);
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);
    const out = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / audio.numberOfChannels;
    }
    return out;
  } catch {
    throw new Error(`Couldn't read the audio in "${file.name}". Try an MP3, or an MP4 with AAC audio.`);
  } finally {
    void ctx.close();
  }
}
