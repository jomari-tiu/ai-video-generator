// Minimal ZIP reader: stored and deflated entries, read via the central directory
// (so archives that use data descriptors also work). Decompression uses the browser's DecompressionStream.

export interface ZipEntry {
  name: string;
  blob: Blob;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
};

export const mimeFor = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";

export async function unzip(file: Blob): Promise<ZipEntry[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);

  // End of central directory: scan back from the end (it may be followed by a comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP file");

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("damaged ZIP file");
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/") || name.startsWith("__MACOSX/") || name.split("/").pop()!.startsWith(".")) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = buf.slice(start, start + size);
    let blob: Blob;
    if (method === 0) blob = new Blob([raw], { type: mimeFor(name) });
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      blob = new Blob([await new Response(stream).arrayBuffer()], { type: mimeFor(name) });
    } else throw new Error(`"${name}" uses a compression method this app can't read`);
    out.push({ name, blob });
  }
  return out;
}
