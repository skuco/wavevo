import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { assertUploadId, uploadDirectory } from "@/lib/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const filePath = path.join(uploadDirectory(assertUploadId(id)), "export.mp4");
    const details = await stat(filePath);
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(details.size),
        "Content-Disposition": `attachment; filename="wavevo-${id.slice(0, 8)}.mp4"`,
      },
    });
  } catch {
    return Response.json({ error: "Export not found." }, { status: 404 });
  }
}
