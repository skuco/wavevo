export const VIDEO_RESOLUTIONS = {
  "1080p": { label: "Full HD", width: 1920, height: 1080, scale: 1 },
  "4k": { label: "4K UHD", width: 3840, height: 2160, scale: 2 },
} as const;

export type VideoResolution = keyof typeof VIDEO_RESOLUTIONS;
