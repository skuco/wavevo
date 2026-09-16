import { jobStore } from "@/lib/server/render-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = jobStore().get((await params).id);
  return job ? Response.json({ job }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Render not found." }, { status: 404 });
}
