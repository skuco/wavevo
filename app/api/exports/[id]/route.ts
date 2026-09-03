import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { assertUploadId, uploadDirectory } from "@/lib/server/paths";
import type { VideoFormat } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const formats: Record<VideoFormat, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const requestedFormat = new URL(request.url).searchParams.get("format") || "mp4";
    if (!(requestedFormat in formats)) return Response.json({ error: "Unknown video format." }, { status: 400 });
    const format = requestedFormat as VideoFormat;
    const filePath = path.join(uploadDirectory(assertUploadId(id)), `export.${format}`);
    const details = await stat(filePath);
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
      headers: {
        "Content-Type": formats[format],
        "Content-Length": String(details.size),
        "Content-Disposition": `attachment; filename="wavevo-${id.slice(0, 8)}.${format}"`,
      },
    });
  } catch {
    return Response.json({ error: "Export not found." }, { status: 404 });
  }
}
