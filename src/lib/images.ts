import { useStore } from "@/store";
import type { ImageItem } from "@/types";
import { uid } from "./pdf";

const readDataUrl = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });

/** PDFs can embed PNG and JPEG; anything else (WebP, GIF, SVG) is converted to PNG. */
export async function fileToImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let src: string;
    if (file.type === "image/png" || file.type === "image/jpeg") {
      src = await readDataUrl(file);
    } else {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      src = c.toDataURL("image/png");
    }
    return { src, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Drop an image in the middle of the page in view, scaled to fit comfortably. */
export function placeImage(src: string, w: number, h: number, signature = false) {
  const s = useStore.getState();
  const page = s.pages.find((p) => p.id === s.currentPageId) ?? s.pages[0];
  if (!page) return;
  const max = signature ? { w: page.width * 0.35, h: page.height * 0.12 } : { w: page.width * 0.6, h: page.height * 0.5 };
  const k = Math.min(1, max.w / w, max.h / h);
  const item: ImageItem = {
    kind: "image",
    id: uid(),
    w: w * k,
    h: h * k,
    x: (page.width - w * k) / 2,
    y: (page.height - h * k) / 2,
    src,
    signature,
  };
  s.addItem(page.id, item);
  s.setTool("select");
  s.select({ pageId: page.id, itemId: item.id });
}

export function pickFile(accept: string, multiple = false) {
  return new Promise<File[]>((ok) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept, multiple });
    input.onchange = () => ok(Array.from(input.files ?? []));
    input.click();
  });
}
