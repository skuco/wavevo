import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { createPeaks, createPlaybackCopy, probeAudio } from "@/lib/server/media";
import { uploadDirectory } from "@/lib/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 200 * 1024 * 1024;
const EXTENSIONS = new Set([".wav", ".mp3", ".flac"]);

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data") || !request.body) {
    return Response.json({ error: "Expected a multipart audio upload." }, { status: 400 });
  }

  const id = randomUUID();
  const directory = uploadDirectory(id);
  await mkdir(directory, { recursive: true });

  try {
    const uploaded = await receiveUpload(request, directory);
    const details = await probeAudio(uploaded.path);
    const extension = path.extname(uploaded.path);
    const matchesContainer =
      (extension === ".wav" && details.format.includes("wav")) ||
      (extension === ".mp3" && details.format.includes("mp3")) ||
      (extension === ".flac" && details.format.includes("flac"));
    if (!matchesContainer) throw new Error("The file contents do not match its WAV, MP3, or FLAC extension.");
    const playbackPath = path.join(directory, "playback.mp3");
    const peaksPath = path.join(directory, "peaks.json");
    const [peaks] = await Promise.all([
      createPeaks(uploaded.path, details.duration),
      createPlaybackCopy(uploaded.path, playbackPath),
    ]);
    await writeFile(peaksPath, JSON.stringify(peaks));
    await writeFile(path.join(directory, "metadata.json"), JSON.stringify({ ...details, name: uploaded.name }));

    return Response.json({ id, name: uploaded.name, duration: details.duration, peaks, audioUrl: `/api/uploads/${id}/audio` });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : "Upload could not be processed.";
    const status = /large|format|audio|file/i.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}

function receiveUpload(request: Request, directory: string) {
  return new Promise<{ path: string; name: string }>((resolve, reject) => {
    const parser = Busboy({ headers: Object.fromEntries(request.headers), limits: { files: 1, fileSize: MAX_SIZE } });
    let received = false;
    let filePromise: Promise<void> | null = null;
    let result: { path: string; name: string } | null = null;

    parser.on("file", (field, file, info) => {
      if (field !== "audio" || received) { file.resume(); return; }
      received = true;
      const extension = path.extname(info.filename).toLowerCase();
      if (!EXTENSIONS.has(extension)) { file.resume(); reject(new Error("Choose a WAV, MP3, or FLAC audio file.")); return; }
      const target = path.join(directory, `original${extension}`);
      result = { path: target, name: path.basename(info.filename) || `audio${extension}` };
      const output = createWriteStream(target, { flags: "wx" });
      file.pipe(output);
      filePromise = new Promise<void>((finish, fail) => {
        output.on("finish", finish);
        output.on("error", fail);
        file.on("limit", () => fail(new Error("That file is larger than the 200 MB limit.")));
      });
    });
    parser.on("error", reject);
    parser.on("finish", async () => {
      try {
        if (!received || !filePromise || !result) throw new Error("No audio file was provided.");
        await filePromise;
        resolve(result);
      } catch (error) { reject(error); }
    });
    Readable.fromWeb(request.body as never).pipe(parser);
  });
}
