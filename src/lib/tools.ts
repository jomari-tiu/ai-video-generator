import {
  Circle,
  Eraser,
  Highlighter,
  ImagePlus,
  MousePointer2,
  Pen,
  Signature,
  Slash,
  Square,
  SquareDashed,
  TextCursorInput,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { Tool } from "@/types";
import { useStore } from "@/store";
import { fileToImage, pickFile, placeImage } from "./images";

export type ToolDef = { id: Tool; label: string; key: string; icon: LucideIcon };

export const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: "select", label: "Select", key: "V", icon: MousePointer2 },
    { id: "edit-text", label: "Edit text", key: "E", icon: TextCursorInput },
    { id: "text", label: "Add text", key: "T", icon: Type },
  ],
  [
    { id: "image", label: "Image", key: "I", icon: ImagePlus },
    { id: "signature", label: "Signature", key: "S", icon: Signature },
  ],
  [
    { id: "rect", label: "Rectangle", key: "R", icon: Square },
    { id: "ellipse", label: "Ellipse", key: "O", icon: Circle },
    { id: "line", label: "Line", key: "L", icon: Slash },
  ],
  [
    { id: "pen", label: "Draw", key: "P", icon: Pen },
    { id: "highlight", label: "Highlight", key: "H", icon: Highlighter },
  ],
  [
    { id: "whiteout", label: "Whiteout", key: "W", icon: Eraser },
    { id: "redact", label: "Redact", key: "X", icon: SquareDashed },
  ],
];

export async function chooseTool(id: Tool, openSignature: () => void) {
  const s = useStore.getState();
  if (id === "image") {
    const [file] = await pickFile("image/*");
    if (!file) return;
    try {
      const img = await fileToImage(file);
      placeImage(img.src, img.w, img.h);
    } catch {
      s.setError("That image couldn't be read. Try a PNG or JPEG.");
    }
    return;
  }
  if (id === "signature") {
    openSignature();
    return;
  }
  s.setTool(id);
}
