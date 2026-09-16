export const VIDEO_QUALITIES = {
  high: {
    label: "High quality",
    description: "Sharper detail with broad player compatibility. Recommended for sharing and everyday playback.",
    encoder: "libx264", preset: "medium", crf: "10", pixelFormat: "yuv420p",
  },
  lossless: {
    label: "Lossless master",
    description: "Preserves every rendered pixel and full color detail. Larger files; requires a player or editor with H.264 RGB support. Audio remains AAC.",
    encoder: "libx264rgb", preset: "veryfast", crf: "0", pixelFormat: "rgb24",
  },
  balanced: {
    label: "Balanced · smaller files",
    description: "The original export quality, with smaller files and faster encoding.",
    encoder: "libx264", preset: "veryfast", crf: "18", pixelFormat: "yuv420p",
  },
} as const;

export type VideoQuality = keyof typeof VIDEO_QUALITIES;
