import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { exportSchema } from "@/lib/server/export-settings";
import { jobStore } from "@/lib/server/render-jobs";
import { uploadDirectory } from "@/lib/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const settings = exportSchema.parse(await request.json());
    const hasSolo = settings.tracks.some(track => track.solo);
    if (!settings.tracks.some(track => !track.muted && (!hasSolo || track.solo) && track.volume > 0)) {
      return Response.json({ error: "Unmute a track before exporting." }, { status: 400 });
    }
    // Only validate source availability here. All audio and video work belongs to the worker.
    const ends = await Promise.all(settings.tracks.map(async track => {
      const directory = uploadDirectory(track.uploadId);
      await access(path.join(directory, "playback.mp3"));
      const metadata = JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8"));
      if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) throw new Error("Invalid source.");
      return track.start + metadata.duration;
    }));
    const job = jobStore().enqueue(settings, Math.max(...ends) + settings.countdown);
    return Response.json({ job }, { status: 202, headers: { Location: `/api/render-jobs/${job.id}` } });
  } catch (caught) {
    if (!(caught instanceof z.ZodError)) console.error(caught);
    return Response.json({ error: caught instanceof z.ZodError || caught instanceof SyntaxError ? "Invalid studio or export settings." : "The session audio is unavailable. Please add your tracks again." }, { status: 400 });
  }
}
