import type { RenderJob } from "./render-job";

export function formatRenderDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", remainder || !seconds ? `${remainder}s` : ""].filter(Boolean).join(" ");
}

export function renderTimeLabel(job: RenderJob, now = Date.now()) {
  if (job.status === "queued") return "Time estimate available when rendering starts";
  if (job.startedAt == null) return job.status === "running" ? "Estimating time…" : "Render time not recorded";
  if (job.finishedAt != null) {
    const duration = formatRenderDuration(job.finishedAt - job.startedAt);
    return job.status === "completed" ? `Rendered in ${duration}` : `Stopped after ${duration}`;
  }
  const elapsed = `Elapsed ${formatRenderDuration(now - job.startedAt)}`;
  if (job.stage === "Finalizing video" || job.stage === "Saving video") return `${elapsed} · Finishing up…`;
  if (job.estimatedFinishAt == null) return `${elapsed} · Estimating time…`;
  const remainingMs = job.estimatedFinishAt - now;
  if (remainingMs <= 0) return `${elapsed} · Updating estimate…`;
  // Round estimates up to five seconds rather than implying exact precision.
  return `${elapsed} · About ${formatRenderDuration(Math.ceil(remainingMs / 5000) * 5000)} left`;
}
