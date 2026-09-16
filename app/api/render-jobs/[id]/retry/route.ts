import { jobStore } from "@/lib/server/render-jobs";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = jobStore().retry((await params).id);
  return job ? Response.json({ job }, { status: 202 }) : Response.json({ error: "Only failed renders can be retried." }, { status: 409 });
}
