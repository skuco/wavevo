import type { CSSProperties } from "react";

const paths = {
  play: "m8 5 11 7-11 7Z",
  pause: "M8 5v14M16 5v14",
  stop: "M6 6h12v12H6Z",
  start: "M5 5v14M19 5 8 12l11 7Z",
  end: "M19 5v14M5 5l11 7-11 7Z",
  loop: "m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3",
  plus: "M12 5v14M5 12h14",
  info: "M12 11v6M12 7v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  edit: "m16 3 5 5L8 21H3v-5ZM13 6l5 5",
  minus: "M5 12h14",
  zoomIn: "M10 6v8M6 10h8m1 5 6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  zoomOut: "M6 10h8m1 5 6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  fit: "M8 4H4v16h4M16 4h4v16h-4M8 12h8m-6-2-2 2 2 2m4-4 2 2-2 2",
  wave: "M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4",
  sliders: "M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4",
  upload: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
  download: "M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5",
  close: "m6 6 12 12M6 18 18 6",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  headphones: "M4 14v-3a8 8 0 0 1 16 0v3M4 12h3v9H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm16 0h-3v9h3a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2Z",
  sun: "M12 2v2M12 20v2M2 12h2M20 12h2m-3-9-1 1M6 18l-1 1M5 5l1 1m12 12 1 1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  moon: "M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z",
  chevron: "m8 5 7 7-7 7",
  music: "M9 18V5l12-2v13M9 9l12-2M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0m12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  check: "m5 12 4 4L19 6",
  speaker: "m11 5-6 5H2v4h3l6 5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
} as const;

export function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
