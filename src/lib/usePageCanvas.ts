import { useEffect, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist";
import type { PageRef } from "@/types";
import { getPage } from "./pdf";

/**
 * Renders a page into a canvas at `scale` CSS px per page unit (times devicePixelRatio),
 * only once the canvas is near the viewport.
 */
export function usePageCanvas(page: PageRef, scale: number, eager = false) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager) return;
    const el = canvasRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [eager]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.ceil(page.width * scale * dpr);
    const h = Math.ceil(page.height * scale * dpr);
    let task: RenderTask | null = null;
    let cancelled = false;

    if (!page.srcId) {
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      return;
    }

    getPage(page.srcId, page.srcIndex).then((p) => {
      if (cancelled) return;
      const viewport = p.getViewport({ scale: scale * dpr });
      // Render offscreen, then swap, so zooming never flashes a blank page.
      const off = document.createElement("canvas");
      off.width = Math.ceil(viewport.width);
      off.height = Math.ceil(viewport.height);
      task = p.render({ canvas: off, viewport });
      task.promise
        .then(() => {
          if (cancelled) return;
          canvas.width = off.width;
          canvas.height = off.height;
          canvas.getContext("2d")!.drawImage(off, 0, 0);
        })
        .catch(() => {
          /* cancelled by a newer render */
        });
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [page.srcId, page.srcIndex, page.width, page.height, scale, visible]);

  return { canvasRef };
}
