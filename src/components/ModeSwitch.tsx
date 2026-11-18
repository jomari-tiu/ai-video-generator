import { Captions, Clapperboard, Grid3x3, House } from "lucide-react";
import { go, SECTION_TITLES, type AiTab, type Section } from "@/lib/route";

const AI_TABS: { id: AiTab; label: string; Icon: typeof Captions }[] = [
  { id: "subtitles", label: "Make subtitles", Icon: Captions },
  { id: "split", label: "Split image", Icon: Grid3x3 },
  { id: "video", label: "SRT video", Icon: Clapperboard },
];

/** The bar at the top of every tool page: back to the landing page, plus the AI video tabs. */
export function ModeSwitch({ section, tab }: { section: Exclude<Section, "home">; tab: AiTab }) {
  return (
    <nav className="mode-switch" aria-label={SECTION_TITLES[section]}>
      <button type="button" className="mode-home" onClick={() => go("home")} aria-label="Back to the start page" title="Back to the start page">
        <House size={16} />
        <span>Home</span>
      </button>
      {section === "ai" ? (
        AI_TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => go("ai", id)}>
            <Icon size={16} />
            {label}
          </button>
        ))
      ) : (
        <span className="mode-title">{SECTION_TITLES[section]}</span>
      )}
    </nav>
  );
}
