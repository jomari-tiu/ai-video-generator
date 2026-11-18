import { ArrowRight, FileText, Images, Sparkles } from "lucide-react";
import { go, type Section } from "@/lib/route";

const CHOICES: { id: Exclude<Section, "home">; title: string; text: string; parts: string[]; Icon: typeof FileText }[] = [
  {
    id: "pdf",
    title: "Edit a PDF",
    text: "Change text, sign, highlight, redact and rearrange pages, then download the edited file.",
    parts: ["Edit text", "Sign", "Redact", "Merge"],
    Icon: FileText,
  },
  {
    id: "ai",
    title: "Create AI video",
    text: "Turn speech into subtitles, cut a picture grid into scenes, and build a narrated video from them.",
    parts: ["Make subtitles", "Split image", "SRT video"],
    Icon: Sparkles,
  },
  {
    id: "montage",
    title: "Image to video",
    text: "Put pictures and clips in order, pick how long each shows and how they transition, and get one MP4.",
    parts: ["Pictures + clips", "Transitions", "Music"],
    Icon: Images,
  },
];

export function Landing() {
  return (
    <main className="welcome landing">
      <div className="landing-body">
        <header className="landing-head">
          <span className="brand-mark" aria-hidden="true" />
          <h1>What do you want to make?</h1>
          <p className="lede">Everything runs in your browser. Your files never leave this computer.</p>
        </header>
        <div className="landing-choices">
          {CHOICES.map(({ id, title, text, parts, Icon }) => (
            <button key={id} type="button" className="landing-card" onClick={() => go(id)}>
              <span className="landing-icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <strong>{title}</strong>
              <span className="landing-text">{text}</span>
              <span className="landing-parts">
                {parts.map((p) => (
                  <span key={p}>{p}</span>
                ))}
              </span>
              <span className="landing-go">
                Open <ArrowRight size={16} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
