import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import Studio from "@/app/components/studio";
import { assertUploadId, uploadDirectory } from "@/lib/server/paths";
import type { StudioRenderSession } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function StudioRender({ params }: { params: Promise<{ id: string }> }) {
  let session: StudioRenderSession;
  try {
    const { id } = await params;
    const raw = await readFile(path.join(uploadDirectory(assertUploadId(id)), "studio.json"), "utf8");
    session = JSON.parse(raw) as StudioRenderSession;
  } catch { notFound(); }
  return <Studio renderSession={session} />;
}
