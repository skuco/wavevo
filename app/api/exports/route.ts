import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createVideo, renderWaveformImage } from "@/lib/server/media";
import { assertUploadId, uploadDirectory } from "@/lib/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  uploadId: z.string().uuid(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  showProgress: z.boolean(),
  countdown: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]),
});

export async function POST(request: Request) {
  try {
    const settings = requestSchema.parse(await request.json());
    const id = assertUploadId(settings.uploadId);
    const directory = uploadDirectory(id);
    const metadata = JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8")) as { duration: number };
    const imagePath = path.join(directory, "waveform.png");
    const playedImagePath = path.join(directory, "waveform-played.png");
    const outputPath = path.join(directory, "export.mp4");
    const peaksPath = path.join(directory, "peaks.json");
    await Promise.all([
      renderWaveformImage(peaksPath, imagePath, settings.color),
      renderWaveformImage(peaksPath, playedImagePath, "#f4f1e9"),
    ]);
    await createVideo(path.join(directory, "playback.mp3"), imagePath, playedImagePath, outputPath, metadata.duration, settings);
    return Response.json({ downloadUrl: `/api/exports/${id}` });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error && error.name === "ZodError" ? "Invalid export settings." : "Video export failed. Check that FFmpeg supports H.264 on this machine.";
    return Response.json({ error: message }, { status: 400 });
  }
}
