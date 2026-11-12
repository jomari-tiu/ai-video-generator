# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + Vite + TypeScript (user's choice). pdf.js renders pages and reads existing text; pdf-lib writes the edited file. zustand for state, lucide-react for icons. Runs entirely in the browser.

## Users

Anyone who needs to change a PDF they were sent: fix a line of text, fill and sign a form, highlight, redact private details, or reorder and merge pages.

## Product Purpose

Open any PDF, edit it, download the edited file. Success = the downloaded PDF looks exactly like the editor showed it.

## Capabilities and Constraints

- Edit existing text: covers the original run and redraws it in the closest standard font (Helvetica, Times, Courier) with ink and paper colours sampled from the page. The original text stays in the file underneath.
- Add text, images, signatures, rectangles, ellipses, lines, freehand drawing, highlights, whiteout, redaction.
- Redaction rasterises the affected page on export so the text under the box is removed.
- Page tools: rotate, delete, insert blank, drag to reorder, merge more PDFs.
- Subtitles mode: upload an MP3/MP4 (or M4A), get timestamped SRT or VTT. Transcription runs in the browser with Whisper (transformers.js, WebGPU with CPU fallback) in a Web Worker. The model (≈40/80/250 MB for Fast/Balanced/Accurate) downloads once from Hugging Face and is cached; the media itself never leaves the computer. Optional spoken-language hint and translate-to-English.
- Split image mode: cut a collage (default 3 × 3) into separate pictures. Detects plain-colour borders and gutters and leaves them out; can centre-crop each picture to 16:9, 4:3, 1:1 or 9:16. Download one picture or all as a ZIP (PNG or JPG). Runs locally.
- SRT video mode: SRT + images (or ZIPs of images, e.g. from Split image; ZIPs and their entries are ordered by number) + audio → MP4 (H.264/AAC via WebCodecs + mediabunny). Each subtitle line gets an image (spread evenly when counts differ, editable per line); images hold until the next change. Options: size (1080p, 720p, vertical, square), fill or fit, burn-in subtitles, animated zoom 100–105%, crossfade, click sound on image change. Live preview is drawn by the same function as the export.
- Limits: standard PDF fonts only cover Latin-1 text (other characters become "?" with a warning); sideways text and scans can't be edited in place; password-protected PDFs are refused.

## Brand Commitments

- Files never leave the user's computer; nothing is uploaded.

## Product Principles

1. What you see in the editor is what you download.
2. Be honest about limits in the UI (covered vs removed, font substitution).
3. Familiar editor conventions over novelty: this is a tool people operate.
