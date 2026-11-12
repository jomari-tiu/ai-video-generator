/**
 * Every coordinate on an item is in "page units": PDF points in the page's own
 * viewport at scale 1 (pdf.js applies the page's intrinsic /Rotate), origin top-left.
 * The user's extra page rotation is applied on top, at display and at export.
 */

export type FontFamily = "Helvetica" | "Times" | "Courier";

export type TextItem = {
  kind: "text";
  id: string;
  x: number;
  y: number;
  text: string;
  font: FontFamily;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  /** Present when this item replaces text that was already in the PDF. */
  cover?: { x: number; y: number; w: number; h: number; color: string; key: string };
};

export type BoxKind = "rect" | "ellipse" | "whiteout" | "redact";

export type BoxItem = {
  kind: BoxKind;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill: string | null;
  strokeWidth: number;
};

export type ImageItem = {
  kind: "image";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src: string; // data URL (png or jpeg)
  signature?: boolean;
};

export type LineItem = {
  kind: "line";
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
};

export type InkItem = {
  kind: "ink";
  id: string;
  points: [number, number][];
  stroke: string;
  strokeWidth: number;
  opacity: number;
  highlighter: boolean;
};

export type Item = TextItem | BoxItem | ImageItem | LineItem | InkItem;

export type PageRef = {
  id: string;
  /** null for a blank page the user inserted. */
  srcId: string | null;
  srcIndex: number;
  width: number;
  height: number;
  /** Extra clockwise rotation chosen in the editor: 0, 90, 180 or 270. */
  rotation: number;
  items: Item[];
};

export type Tool =
  | "select"
  | "edit-text"
  | "text"
  | "image"
  | "signature"
  | "rect"
  | "ellipse"
  | "line"
  | "pen"
  | "highlight"
  | "whiteout"
  | "redact";

export type ToolStyle = {
  font: FontFamily;
  size: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  penColor: string;
  penWidth: number;
  highlightColor: string;
};
