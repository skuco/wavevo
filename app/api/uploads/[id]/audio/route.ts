import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { assertUploadId, uploadDirectory } from "@/lib/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const filePath = path.join(uploadDirectory(assertUploadId(id)), "playback.mp3");
    const details = await stat(filePath);
    const range = request.headers.get("range");
    const headers = { "Accept-Ranges": "bytes", "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" };
    if (!range) {
      return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, { headers: { ...headers, "Content-Length": String(details.size) } });
    }
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) return new Response(null, { status: 416 });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), details.size - 1) : details.size - 1;
    if (start > end || start >= details.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${details.size}` } });
    return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${details.size}` },
    });
  } catch {
    return Response.json({ error: "Audio not found." }, { status: 404 });
  }
}
