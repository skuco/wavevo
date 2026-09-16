"use client";

import { useCallback, useEffect, useState } from "react";
import { isActiveJob, type RenderJob } from "@/lib/render-job";

export function announceRender(job: RenderJob) {
  window.dispatchEvent(new CustomEvent("wavevo:render-queued", { detail: job }));
}

export function useRenderJobs(enabled: boolean) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    if (!enabled) return;
    setDismissed(localStorage.getItem("wavevo-dismissed-render") || "");
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const refresh = async () => {
      clearTimeout(timer);
      controller?.abort();
      const request = new AbortController();
      controller = request;
      let interval = 3000;
      try {
        const response = await fetch("/api/render-jobs", { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error("Could not load videos.");
        const result = await response.json() as { jobs: RenderJob[] };
        if (stopped || request.signal.aborted) return;
        setJobs(result.jobs); setError(""); setLoaded(true);
        interval = result.jobs.some(isActiveJob) ? 1000 : 5000;
      } catch {
        if (stopped || request.signal.aborted) return;
        setError("Connection lost. Reconnecting to your renders…");
      } finally {
        if (!stopped && !request.signal.aborted) timer = setTimeout(() => void refresh(), interval);
      }
    };
    const queued = (event: Event) => {
      const job = (event as CustomEvent<RenderJob>).detail;
      setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]);
      void refresh();
    };
    const wake = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("wavevo:render-queued", queued);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    void refresh();
    return () => {
      stopped = true; clearTimeout(timer); controller?.abort();
      window.removeEventListener("wavevo:render-queued", queued);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [enabled]);
  const dismiss = useCallback((id: string) => { setDismissed(id); localStorage.setItem("wavevo-dismissed-render", id); }, []);
  const active = jobs.filter(isActiveJob);
  const current = active.find(job => job.status === "running") || active.at(-1);
  const latest = jobs.filter(job => !isActiveJob(job)).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
  const notice = latest && latest.id !== dismissed ? latest : undefined;
  return { jobs, active, current, notice, dismiss, error, loaded };
}
