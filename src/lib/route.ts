import { useSyncExternalStore } from "react";

export type Section = "home" | "pdf" | "ai" | "montage";
export type AiTab = "subtitles" | "split" | "video";

export const SECTION_TITLES: Record<Exclude<Section, "home">, string> = {
  pdf: "Edit a PDF",
  ai: "Create AI video",
  montage: "Image to video",
};

/**
 * Where we are lives in the URL hash (#pdf, #ai/split, #montage), so refresh keeps the page
 * and the browser's Back button returns to the landing page.
 */
function read(): { section: Section; tab: AiTab } {
  const [s, t] = location.hash.replace(/^#\/?/, "").split("/");
  const section: Section = s === "pdf" || s === "ai" || s === "montage" ? s : "home";
  const tab: AiTab = t === "split" || t === "video" ? t : "subtitles";
  return { section, tab };
}
let snapshot = read();
const subscribe = (cb: () => void) => {
  const on = () => {
    snapshot = read();
    cb();
  };
  window.addEventListener("hashchange", on);
  return () => window.removeEventListener("hashchange", on);
};
export function useRoute() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
export function go(section: Section, tab?: AiTab) {
  location.hash = section === "home" ? "" : section === "ai" ? `ai/${tab ?? snapshot.tab}` : section;
}
