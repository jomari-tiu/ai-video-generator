import { Captions, Clapperboard, FileText, Grid3x3 } from "lucide-react";

export type Mode = "pdf" | "subtitles" | "split" | "video";

const MODES: { id: Mode; label: string; Icon: typeof FileText }[] = [
  { id: "pdf", label: "Edit a PDF", Icon: FileText },
  { id: "subtitles", label: "Make subtitles", Icon: Captions },
  { id: "split", label: "Split image", Icon: Grid3x3 },
  { id: "video", label: "SRT video", Icon: Clapperboard },
];

export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <nav className="mode-switch" aria-label="Tool">
      {MODES.map(({ id, label, Icon }) => (
        <button key={id} type="button" aria-pressed={mode === id} onClick={() => onChange(id)}>
          <Icon size={16} />
          {label}
        </button>
      ))}
    </nav>
  );
}
