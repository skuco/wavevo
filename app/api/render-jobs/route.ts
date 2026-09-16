import { jobStore } from "@/lib/server/render-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ jobs: jobStore().list() }, { headers: { "Cache-Control": "no-store" } });
}
