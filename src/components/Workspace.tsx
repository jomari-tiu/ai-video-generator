import { useEffect, useRef } from "react";
import { useStore } from "@/store";
import { PageView } from "./PageView";

export function Workspace() {
  const pages = useStore((s) => s.pages);
  const focusPage = useStore((s) => s.focusPage);
  const ref = useRef<HTMLElement>(null);
  const docId = useStore((s) => s.docId);

  // Fit the widest page to the window once per opened document, not on every page change.
  useEffect(() => {
    const el = ref.current;
    const { pages } = useStore.getState();
    if (!el || !pages.length) return;
    const widest = Math.max(...pages.map((p) => (p.rotation % 180 ? p.height : p.width)));
    useStore.getState().setZoom(Math.min(1.5, (el.clientWidth - 88) / widest));
  }, [docId]);

  // Track the page most in view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ratios = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set((e.target as HTMLElement).dataset.pageId!, e.intersectionRatio);
        let best: string | null = null;
        let max = 0;
        for (const [id, r] of ratios) if (r > max) [best, max] = [id, r];
        if (best && best !== useStore.getState().currentPageId) useStore.getState().setCurrentPage(best);
      },
      { root: el, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    el.querySelectorAll(".page-slot").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [pages]);

  useEffect(() => {
    if (!focusPage) return;
    ref.current
      ?.querySelector(`[data-page-id="${focusPage.id}"]`)
      ?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, [focusPage]);

  // Ctrl/Cmd + wheel zooms the document instead of the browser.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = useStore.getState();
      s.setZoom(s.zoom * Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <main className="desk" ref={ref} aria-label="Document">
      {pages.map((p, i) => (
        <section key={p.id} className="page-wrap" aria-label={`Page ${i + 1} of ${pages.length}`}>
          <PageView page={p} index={i} />
          <span className="page-num">
            {i + 1} / {pages.length}
          </span>
        </section>
      ))}
    </main>
  );
}
