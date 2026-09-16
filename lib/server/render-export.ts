import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAudioMix, createLevelEnvelope } from "./mix";
import { createPeaks, probeAudio } from "./media";
import { createStudioVideo } from "./studio-video";
import { uploadDirectory } from "./paths";
import { VIDEO_RESOLUTIONS } from "../video-resolution";
import type { StudioRenderSession } from "../types";
import type { RenderRequest } from "./export-settings";

export async function renderExport(id: string, settings: RenderRequest, progress: (value: number, stage: string) => void, signal: AbortSignal) {
  const hasSolo = settings.tracks.some(track => track.solo);
  progress(1, "Preparing audio");
  const inputs = await Promise.all(settings.tracks.map(async track => {
    const source = uploadDirectory(track.uploadId);
    const metadata = JSON.parse(await readFile(path.join(source, "metadata.json"), "utf8")) as { duration: number; name: string };
    const audioPath = path.join(source, "playback.mp3");
    const { channels } = await probeAudio(audioPath);
    return { ...track, name: track.name || metadata.name, path: audioPath, duration: metadata.duration, channels };
  }));
  const audible = inputs.filter(track => !track.muted && (!hasSolo || track.solo) && track.volume > 0);
  const duration = Math.max(...inputs.map(track => track.start + track.duration));
  const directory = uploadDirectory(id);
  await mkdir(directory, { recursive: true });
  const mixPath = path.join(directory, "mix.wav");
  await createAudioMix(audible, mixPath, duration, settings.masterVolume, signal);

  progress(5, "Analyzing tracks");
  const tracks: StudioRenderSession["tracks"] = [];
  // Bound audio analysis to one track at a time for larger sessions.
  for (const input of inputs) {
    signal.throwIfAborted();
    const source = uploadDirectory(input.uploadId);
    const peaks = JSON.parse(await readFile(path.join(source, "peaks.json"), "utf8")) as number[];
    let channelPeaks: number[][];
    try { channelPeaks = JSON.parse(await readFile(path.join(source, "channels.json"), "utf8")); }
    catch {
      channelPeaks = input.channels > 1 ? await Promise.all([createPeaks(input.path, input.duration, 0), createPeaks(input.path, input.duration, 1)]) : [peaks];
    }
    const meterPeaks = audible.includes(input) ? await createLevelEnvelope(input, signal) : [];
    tracks.push({ id: input.uploadId, name: input.name, duration: input.duration, peaks, channelPeaks, audioUrl: `/api/uploads/${input.uploadId}/audio`, color: input.color, volume: input.volume, pan: input.pan, start: input.start, muted: input.muted, solo: input.solo, meterPeaks });
  }
  progress(10, "Opening studio");
  const session: StudioRenderSession = { sessionName: settings.sessionName, tracks, settings, masterVolume: settings.masterVolume, ...settings.view };
  await writeFile(path.join(directory, "studio.json"), JSON.stringify(session));
  const { width, height } = VIDEO_RESOLUTIONS[settings.resolution];
  await writeFile(path.join(directory, "metadata.json"), JSON.stringify({ name: settings.sessionName, sessionName: settings.sessionName, duration, resolution: settings.resolution, quality: settings.quality, width, height }));
  await createStudioVideo(id, mixPath, path.join(directory, `export.partial.${settings.format}`), duration, settings, settings.format, settings.resolution, settings.quality, (frames, total) => progress(10 + Math.floor(frames / total * 85), frames === total ? "Finalizing video" : "Rendering frames"), signal);
  progress(99, "Saving video");
  signal.throwIfAborted();
  await rename(path.join(directory, `export.partial.${settings.format}`), path.join(directory, `export.${settings.format}`));
  await rm(path.join(directory, "studio.json"));
  await rm(path.join(directory, "mix.wav"), { force: true });
  return (await stat(path.join(directory, `export.${settings.format}`))).size;
}
