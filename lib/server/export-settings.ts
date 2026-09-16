import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
export const exportSchema = z.object({
  sessionName: z.string().trim().max(120).transform(value => value || "Untitled session").default("Untitled session"),
  tracks: z.array(z.object({
    uploadId: z.string().uuid(), name: z.string().max(256).optional(), color: hexColor.default("#18c9a7"),
    volume: z.number().min(0).max(1), pan: z.number().min(-1).max(1), start: z.number().min(0).max(86400), muted: z.boolean(), solo: z.boolean(),
  })).min(1).max(32),
  masterVolume: z.number().gt(0).max(1),
  showProgress: z.boolean(),
  countdown: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]),
  waveformStyle: z.enum(["rounded", "square", "particles", "wave"]),
  waveformDensity: z.enum(["low", "medium", "high"]),
  videoTheme: z.enum(["dark", "light"]),
  format: z.enum(["mp4", "mov"]),
  resolution: z.enum(["1080p", "4k"]).default("1080p"),
  quality: z.enum(["high", "lossless", "balanced"]).default("high"),
  view: z.object({ selectedId: z.string().uuid().or(z.literal("")).default(""), compact: z.boolean().default(false), fillScreen: z.boolean().default(false), loop: z.boolean().default(false), snap: z.boolean().default(false), snapInterval: z.union([z.literal(1), z.literal(0.5), z.literal(0.1)]).default(1) }).default({ selectedId: "", compact: false, fillScreen: false, loop: false, snap: false, snapInterval: 1 }),
});

export type RenderRequest = z.infer<typeof exportSchema>;
