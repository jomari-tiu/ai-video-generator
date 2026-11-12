import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

export type Source = {
  id: string;
  name: string;
  /** Original bytes, kept untouched for pdf-lib at export. */
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
};

const sources = new Map<string, Source>();
const pageCache = new Map<string, Promise<PDFPageProxy>>();

export const uid = () => Math.random().toString(36).slice(2, 10);

export async function loadSource(file: File | { name: string; bytes: Uint8Array }): Promise<Source> {
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const source: Source = { id: uid(), name: file.name, bytes, doc };
  sources.set(source.id, source);
  return source;
}

export function getSource(id: string) {
  const s = sources.get(id);
  if (!s) throw new Error(`Unknown PDF source ${id}`);
  return s;
}

export function getPage(srcId: string, index: number) {
  const key = `${srcId}:${index}`;
  let p = pageCache.get(key);
  if (!p) {
    p = getSource(srcId).doc.getPage(index + 1);
    pageCache.set(key, p);
  }
  return p;
}
