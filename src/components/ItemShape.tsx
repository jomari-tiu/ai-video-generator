import type { Item } from "@/types";
import { ASCENT, CSS_FAMILY, LEADING } from "@/lib/text";

/** One item drawn in page units inside the page's SVG overlay. */
export function ItemShape({ item, hidden }: { item: Item; hidden?: boolean }) {
  switch (item.kind) {
    case "text":
      return (
        <g data-item={item.id}>
          {item.cover && (
            <rect x={item.cover.x} y={item.cover.y} width={item.cover.w} height={item.cover.h} fill={item.cover.color} />
          )}
          {!hidden && (
            <text
              fill={item.color}
              fontFamily={CSS_FAMILY[item.font]}
              fontSize={item.size}
              fontWeight={item.bold ? 700 : 400}
              fontStyle={item.italic ? "italic" : "normal"}
              style={{ whiteSpace: "pre" }}
            >
              {item.text.split("\n").map((line, i) => (
                <tspan key={i} x={item.x} y={item.y + item.size * (ASCENT + LEADING * i)}>
                  {line || " "}
                </tspan>
              ))}
            </text>
          )}
        </g>
      );
    case "rect":
      return (
        <rect
          data-item={item.id}
          x={item.x}
          y={item.y}
          width={item.w}
          height={item.h}
          fill={item.fill ?? "transparent"}
          stroke={item.strokeWidth ? item.stroke : "none"}
          strokeWidth={item.strokeWidth}
        />
      );
    case "ellipse":
      return (
        <ellipse
          data-item={item.id}
          cx={item.x + item.w / 2}
          cy={item.y + item.h / 2}
          rx={Math.abs(item.w / 2)}
          ry={Math.abs(item.h / 2)}
          fill={item.fill ?? "transparent"}
          stroke={item.strokeWidth ? item.stroke : "none"}
          strokeWidth={item.strokeWidth}
        />
      );
    case "whiteout":
    case "redact":
      return (
        <rect
          data-item={item.id}
          x={item.x}
          y={item.y}
          width={item.w}
          height={item.h}
          fill={item.kind === "whiteout" ? "#ffffff" : "#000000"}
        />
      );
    case "line":
      return (
        <g data-item={item.id}>
          {/* A wide invisible stroke makes thin lines easy to grab. */}
          <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="transparent" strokeWidth={Math.max(10, item.strokeWidth + 8)} />
          <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke={item.stroke} strokeWidth={item.strokeWidth} strokeLinecap="round" />
        </g>
      );
    case "ink": {
      const d = item.points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
      return (
        <g data-item={item.id}>
          <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(10, item.strokeWidth + 6)} strokeLinecap="round" strokeLinejoin="round" />
          <path
            d={d}
            fill="none"
            stroke={item.stroke}
            strokeOpacity={item.opacity}
            strokeWidth={item.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={item.highlighter ? { mixBlendMode: "multiply" } : undefined}
          />
        </g>
      );
    }
    case "image":
      return (
        <image data-item={item.id} href={item.src} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="none" />
      );
  }
}
