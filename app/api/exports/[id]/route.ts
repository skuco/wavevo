import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { assertUploadId, uploadDirectory } from "@/lib/server/paths";
import type { VideoFormat } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const formats: Record<VideoFormat, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const requestedFormat = new URL(request.url).searchParams.get("format") || "mp4";
    if (!(requestedFormat in formats)) return Response.json({ error: "Unknown video format." }, { status: 400 });
    const format = requestedFormat as VideoFormat;
    const directory = uploadDirectory(assertUploadId(id));
    const filePath = path.join(directory, `export.${format}`);
    const [details, metadataText] = await Promise.all([
      stat(filePath),
      readFile(path.join(directory, "metadata.json"), "utf8"),
    ]);
    const metadata = JSON.parse(metadataText) as { name?: string };
    const originalName = metadata.name || "wavevo";
    const originalBase = path.basename(originalName, path.extname(originalName));
    const safeBase = originalBase.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim() || "wavevo";
    const downloadName = `${safeBase}-wavevo.${format}`;
    const asciiFallback = downloadName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "-");
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
      headers: {
        "Content-Type": formats[format],
        "Content-Length": String(details.size),
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache",
      },
    });
  } catch {
    return Response.json({ error: "Export not found." }, { status: 404 });
  }
}
