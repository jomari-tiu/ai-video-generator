import { create } from "zustand";
import type { Item, PageRef, Tool, ToolStyle } from "./types";
import { getPage, loadSource, uid } from "./lib/pdf";

type Snapshot = PageRef[];

type State = {
  fileName: string | null;
  /** Changes only when a new document replaces the current one. */
  docId: number;
  pages: PageRef[];
  past: Snapshot[];
  future: Snapshot[];
  tool: Tool;
  style: ToolStyle;
  selected: { pageId: string; itemId: string } | null;
  editingId: string | null;
  zoom: number;
  loading: boolean;
  error: string | null;
  /** Bumped when pages need to scroll into view (e.g. thumbnail click). */
  focusPage: { id: string; n: number } | null;
  /** The page most in view; new images and signatures land here. */
  currentPageId: string | null;
  setCurrentPage: (id: string) => void;

  openFiles: (files: File[], mode: "replace" | "append") => Promise<void>;
  newBlank: () => void;
  setTool: (tool: Tool) => void;
  setStyle: (patch: Partial<ToolStyle>) => void;
  setZoom: (zoom: number) => void;
  select: (sel: State["selected"]) => void;
  setEditing: (id: string | null) => void;
  setError: (msg: string | null) => void;
  goToPage: (id: string) => void;

  /** Record an undo point before a change. */
  checkpoint: () => void;
  addItem: (pageId: string, item: Item, opts?: { select?: boolean; edit?: boolean }) => void;
  /** Patch without recording history; call checkpoint() first for a single undo step. */
  patchItem: (pageId: string, itemId: string, patch: Partial<Item>) => void;
  updateItem: (pageId: string, itemId: string, patch: Partial<Item>) => void;
  removeItem: (pageId: string, itemId: string) => void;

  rotatePage: (pageId: string, delta: number) => void;
  deletePage: (pageId: string) => void;
  insertBlankAfter: (pageId: string | null) => void;
  movePage: (from: number, to: number) => void;

  undo: () => void;
  redo: () => void;
};

const LIMIT = 100;
const A4 = { width: 595.28, height: 841.89 };

const mapItems = (pages: PageRef[], pageId: string, fn: (items: Item[]) => Item[]) =>
  pages.map((p) => (p.id === pageId ? { ...p, items: fn(p.items) } : p));

async function pagesFrom(files: File[]) {
  const pages: PageRef[] = [];
  for (const file of files) {
    const src = await loadSource(file);
    for (let i = 0; i < src.doc.numPages; i++) {
      const page = await getPage(src.id, i);
      const vp = page.getViewport({ scale: 1 });
      pages.push({ id: uid(), srcId: src.id, srcIndex: i, width: vp.width, height: vp.height, rotation: 0, items: [] });
    }
  }
  return pages;
}

export const useStore = create<State>((set, get) => {
  const commit = (pages: PageRef[]) =>
    set((s) => ({ pages, past: [...s.past, s.pages].slice(-LIMIT), future: [] }));

  return {
    fileName: null,
    docId: 0,
    pages: [],
    past: [],
    future: [],
    tool: "select",
    style: {
      font: "Helvetica",
      size: 14,
      bold: false,
      italic: false,
      textColor: "#1b1d22",
      stroke: "#e5482d",
      fill: null,
      strokeWidth: 2,
      penColor: "#1b1d22",
      penWidth: 2,
      highlightColor: "#ffd43b",
    },
    selected: null,
    editingId: null,
    zoom: 1,
    loading: false,
    error: null,
    focusPage: null,
    currentPageId: null,
    setCurrentPage: (currentPageId) => set({ currentPageId }),

    async openFiles(files, mode) {
      const pdfs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
      if (!pdfs.length) {
        set({ error: "That isn't a PDF. Choose a file ending in .pdf." });
        return;
      }
      set({ loading: true, error: null });
      try {
        const added = await pagesFrom(pdfs);
        if (mode === "replace" || !get().pages.length) {
          set({
            pages: added,
            past: [],
            future: [],
            selected: null,
            editingId: null,
            fileName: pdfs[0].name.replace(/\.pdf$/i, ""),
            docId: get().docId + 1,
          });
        } else {
          commit([...get().pages, ...added]);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({
          error: /password/i.test(msg)
            ? "This PDF is password-protected. Remove the password in another app, then open it here."
            : `Couldn't read that PDF: ${msg}`,
        });
      } finally {
        set({ loading: false });
      }
    },

    newBlank() {
      set({
        pages: [{ id: uid(), srcId: null, srcIndex: 0, ...A4, rotation: 0, items: [] }],
        past: [],
        future: [],
        selected: null,
        fileName: "untitled",
        docId: get().docId + 1,
      });
    },

    setTool: (tool) => set({ tool, selected: tool === "select" ? get().selected : null, editingId: null }),
    setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
    setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, Math.round(zoom * 100) / 100)) }),
    select: (selected) => set({ selected, editingId: null }),
    setEditing: (editingId) => set({ editingId }),
    setError: (error) => set({ error }),
    goToPage: (id) => set((s) => ({ focusPage: { id, n: (s.focusPage?.n ?? 0) + 1 } })),

    checkpoint: () => set((s) => ({ past: [...s.past, s.pages].slice(-LIMIT), future: [] })),

    addItem(pageId, item, opts) {
      commit(mapItems(get().pages, pageId, (items) => [...items, item]));
      if (opts?.select) set({ selected: { pageId, itemId: item.id }, editingId: opts.edit ? item.id : null });
    },
    patchItem(pageId, itemId, patch) {
      set((s) => ({
        pages: mapItems(s.pages, pageId, (items) =>
          items.map((it) => (it.id === itemId ? ({ ...it, ...patch } as Item) : it)),
        ),
      }));
    },
    updateItem(pageId, itemId, patch) {
      get().checkpoint();
      get().patchItem(pageId, itemId, patch);
    },
    removeItem(pageId, itemId) {
      commit(mapItems(get().pages, pageId, (items) => items.filter((it) => it.id !== itemId)));
      set({ selected: null, editingId: null });
    },

    rotatePage(pageId, delta) {
      commit(
        get().pages.map((p) => (p.id === pageId ? { ...p, rotation: (((p.rotation + delta) % 360) + 360) % 360 } : p)),
      );
    },
    deletePage(pageId) {
      if (get().pages.length <= 1) {
        set({ error: "A PDF needs at least one page. Add another page before deleting this one." });
        return;
      }
      commit(get().pages.filter((p) => p.id !== pageId));
      if (get().selected?.pageId === pageId) set({ selected: null });
    },
    insertBlankAfter(pageId) {
      const pages = get().pages;
      const at = pageId ? pages.findIndex((p) => p.id === pageId) + 1 : pages.length;
      const ref = pages[Math.max(0, at - 1)];
      const size = ref ? { width: ref.width, height: ref.height } : A4;
      const blank: PageRef = { id: uid(), srcId: null, srcIndex: 0, ...size, rotation: 0, items: [] };
      commit([...pages.slice(0, at), blank, ...pages.slice(at)]);
      get().goToPage(blank.id);
    },
    movePage(from, to) {
      if (from === to) return;
      const pages = [...get().pages];
      const [p] = pages.splice(from, 1);
      pages.splice(to, 0, p);
      commit(pages);
    },

    undo() {
      const { past, pages, future } = get();
      if (!past.length) return;
      set({ pages: past[past.length - 1], past: past.slice(0, -1), future: [pages, ...future], selected: null, editingId: null });
    },
    redo() {
      const { past, pages, future } = get();
      if (!future.length) return;
      set({ pages: future[0], future: future.slice(1), past: [...past, pages], selected: null, editingId: null });
    },
  };
});

if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;
