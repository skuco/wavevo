import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createAudioMix, createLevelEnvelope } from "@/lib/server/mix";
import { createPeaks, probeAudio } from "@/lib/server/media";
import { createStudioVideo } from "@/lib/server/studio-video";
import { uploadDirectory } from "@/lib/server/paths";
import { VIDEO_RESOLUTIONS } from "@/lib/video-resolution";
import type { StudioRenderSession } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const schema = z.object({
  sessionName: z.string().trim().max(120).transform(value => value || "Untitled session").default("Untitled session"),
  tracks: z.array(z.object({
    uploadId: z.string().uuid(), name: z.string().max(256).optional(), color: hexColor.default("#18c9a7"),
    volume: z.number().min(0).max(1), pan: z.number().min(-1).max(1), start: z.number().min(0).max(86400), muted: z.boolean(), solo: z.boolean(),
  })).min(1).max(32),
  masterVolume: z.number().gt(0).max(1),
  color: hexColor,
  showProgress: z.boolean(),
  countdown: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]),
  waveformStyle: z.enum(["rounded", "square", "particles", "wave"]),
  waveformDensity: z.enum(["low", "medium", "high"]),
  videoTheme: z.enum(["dark", "light"]),
  format: z.enum(["mp4", "mov"]),
  resolution: z.enum(["1080p", "4k"]).default("1080p"),
  view: z.object({ selectedId: z.string().uuid().or(z.literal("")).default(""), compact: z.boolean().default(false), loop: z.boolean().default(false), snap: z.boolean().default(false), snapInterval: z.union([z.literal(1), z.literal(0.5), z.literal(0.1)]).default(1) }).default({ selectedId: "", compact: false, loop: false, snap: false, snapInterval: 1 }),
});

export async function POST(request: Request) {
  let directory: string | undefined;
  try {
    const settings = schema.parse(await request.json());
    const hasSolo = settings.tracks.some(track => track.solo);
    if (!settings.tracks.some(track => !track.muted && (!hasSolo || track.solo) && track.volume > 0)) {
      return Response.json({ error: "Unmute a track before exporting." }, { status: 400 });
    }
    const inputs = await Promise.all(settings.tracks.map(async track => {
      const source = uploadDirectory(track.uploadId);
      const metadata = JSON.parse(await readFile(path.join(source, "metadata.json"), "utf8")) as { duration: number; name: string };
      const audioPath = path.join(source, "playback.mp3");
      const { channels } = await probeAudio(audioPath);
      return { ...track, name: track.name || metadata.name, path: audioPath, duration: metadata.duration, channels };
    }));
    const audible = inputs.filter(track => !track.muted && (!hasSolo || track.solo) && track.volume > 0);
    const duration = Math.max(...inputs.map(track => track.start + track.duration));
    const id = randomUUID();
    directory = uploadDirectory(id);
    await mkdir(directory, { recursive: true });
    const mixPath = path.join(directory, "mix.wav");
    await createAudioMix(audible, mixPath, duration, settings.masterVolume);

    const tracks: StudioRenderSession["tracks"] = [];
    // Bound audio analysis to one track at a time for larger sessions.
    for (const input of inputs) {
      const source = uploadDirectory(input.uploadId);
      const peaks = JSON.parse(await readFile(path.join(source, "peaks.json"), "utf8")) as number[];
      let channelPeaks: number[][];
      try { channelPeaks = JSON.parse(await readFile(path.join(source, "channels.json"), "utf8")); }
      catch {
        channelPeaks = input.channels > 1 ? await Promise.all([createPeaks(input.path, input.duration, 0), createPeaks(input.path, input.duration, 1)]) : [peaks];
      }
      const meterPeaks = audible.includes(input) ? await createLevelEnvelope(input) : [];
      tracks.push({ id: input.uploadId, name: input.name, duration: input.duration, peaks, channelPeaks, audioUrl: `/api/uploads/${input.uploadId}/audio`, color: input.color, volume: input.volume, pan: input.pan, start: input.start, muted: input.muted, solo: input.solo, meterPeaks });
    }
    const session: StudioRenderSession = { sessionName: settings.sessionName, tracks, settings, masterVolume: settings.masterVolume, ...settings.view };
    await writeFile(path.join(directory, "studio.json"), JSON.stringify(session));
    const { width, height } = VIDEO_RESOLUTIONS[settings.resolution];
    await writeFile(path.join(directory, "metadata.json"), JSON.stringify({ name: settings.sessionName, sessionName: settings.sessionName, duration, resolution: settings.resolution, width, height }));
    await createStudioVideo(id, mixPath, path.join(directory, `export.${settings.format}`), duration, settings, settings.format, settings.resolution);
    await rm(path.join(directory, "studio.json"));
    return Response.json({ downloadUrl: `/api/exports/${id}?format=${settings.format}` });
  } catch (caught) {
    if (directory) await rm(directory, { recursive: true, force: true });
    console.error(caught);
    const setupError = caught instanceof Error && /WAVEVO_CHROME_PATH|WAVEVO_RENDER_ORIGIN/.test(caught.message);
    return Response.json({ error: caught instanceof z.ZodError ? "Invalid studio or export settings." : setupError ? caught.message : "The studio video could not be exported. Please try again." }, { status: 400 });
  }
}
