"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { formatTime } from "@/lib/format";
import { isActiveJob, type RenderJob } from "@/lib/render-job";
import { VIDEO_QUALITIES } from "@/lib/video-quality";
import { VIDEO_RESOLUTIONS } from "@/lib/video-resolution";

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

type Center = ReturnType<typeof useRenderJobs>;

export function RenderLibraryButton({ center, onClick }: { center: Center; onClick: () => void }) {
  return <button className="secondary-button render-library-button" onClick={onClick} aria-haspopup="dialog">
    <Icon name="video" size={16} /><span>Videos</span>
    {center.active.length > 0 && <span className="render-count" aria-label={`${center.active.length} ongoing renders`}>{center.active.length}</span>}
  </button>;
}

export function RenderStatus({ center, onOpen }: { center: Center; onOpen: () => void }) {
  const job = center.current || center.notice;
  if (!job && !center.error) return null;
  const active = job && isActiveJob(job);
  return <section className={`render-strip ${job?.status === "failed" ? "render-strip-failed" : ""}`} aria-label="Video render status">
    <span className="render-strip-icon">{active ? <span className="spinner" /> : <Icon name={job?.status === "completed" ? "check" : "info"} size={18} />}</span>
    <div className="render-strip-copy"><strong>{center.error || (job?.status === "completed" ? "Your video is ready" : job?.status === "failed" ? "Video render failed" : job?.stage)}</strong><span title={job?.sessionName}>{job?.sessionName}{center.active.length > 1 && ` · ${center.active.length - 1} more in queue`}</span></div>
    {job && <div className="render-strip-progress"><span>{job.status === "failed" ? "Needs retry" : `${job.progress}%`}</span>{active && <progress value={job.progress} max={100} aria-label="Render progress" />}</div>}
    {center.current && center.notice?.status === "completed" && <a className="render-ready-link" href={center.notice.downloadUrl!} download><Icon name="check" size={15} /> Video ready</a>}
    {!active && job?.downloadUrl && <a className="secondary-button" href={job.downloadUrl} download><Icon name="download" size={15} /> Download</a>}
    <button className="render-view-button" onClick={onOpen}>View videos <Icon name="chevron" size={13} /></button>
    {!active && job && <button className="icon-button" aria-label="Dismiss render notification" onClick={() => center.dismiss(job.id)}><Icon name="close" size={16} /></button>}
    <span className="visually-hidden" role="status">{center.notice?.status === "completed" ? `${center.notice.sessionName}: video ready to download.` : center.notice?.status === "failed" ? `${center.notice.sessionName}: render failed.` : ""}</span>
  </section>;
}

const fileSize = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;

function RenderCard({ job }: { job: RenderJob }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const retry = async () => {
    setRetrying(true); setError("");
    try {
      const response = await fetch(`/api/render-jobs/${job.id}/retry`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not retry this render.");
      announceRender(result.job);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not retry this render."); }
    finally { setRetrying(false); }
  };
  return <article className={`render-card render-card-${job.status}`}>
    <div className="render-card-top"><span className="render-video-icon"><Icon name="video" size={22} /></span><div className="render-card-title"><h3 title={job.sessionName}>{job.sessionName}</h3><span>{job.resolution ? VIDEO_RESOLUTIONS[job.resolution].label : "Video"} · {job.format.toUpperCase()} · {formatTime(job.duration)}{job.quality && ` · ${VIDEO_QUALITIES[job.quality].label}`}</span></div><span className={`render-badge ${job.status}`}>{job.status === "running" ? `${job.progress}%` : job.status === "completed" ? "Complete" : job.status === "queued" ? "Queued" : "Failed"}</span></div>
    {isActiveJob(job) && <div className="render-card-progress"><div><span>{job.stage}</span><span>{job.progress}%</span></div><progress value={job.progress} max={100} aria-label={`${job.sessionName} render progress`} /></div>}
    {job.error && <p className="render-card-error">{job.error}</p>}
    {error && <p className="render-card-error" role="alert">{error}</p>}
    <div className="render-card-bottom"><span>{new Date(job.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}{job.bytes !== null && ` · ${fileSize(job.bytes)}`}</span>{job.downloadUrl && <a className="secondary-button" href={job.downloadUrl} download><Icon name="download" size={14} /> Download</a>}{job.status === "failed" && <button className="secondary-button" disabled={retrying} onClick={() => void retry()}><Icon name="loop" size={14} />{retrying ? "Queuing…" : "Retry render"}</button>}</div>
  </article>;
}

export function RenderLibrary({ center, onClose }: { center: Center; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const finished = center.jobs.filter(job => !isActiveJob(job));
  return <dialog ref={ref} className="export-dialog render-library" aria-labelledby="render-library-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-heading"><span className="eyebrow">YOUR VIDEO LIBRARY</span><button className="icon-button" aria-label="Close video library" onClick={onClose} autoFocus><Icon name="close" /></button></div>
    <h2 id="render-library-title">Made of your sound.</h2><p>Follow your renders and download finished videos. Keep creating while we take care of the frames.</p>
    <div className="render-library-summary"><span><i className="render-dot" />{center.active.length} ongoing</span><span>{center.jobs.filter(job => job.status === "completed").length} completed</span><span>Saved locally</span></div>
    {center.error && <p className="dialog-error" role="status">{center.error}</p>}
    <div className="render-library-list">
      {!center.loaded && !center.error && <p className="render-empty"><span className="spinner" /> Loading your videos…</p>}
      {center.loaded && !center.jobs.length && <div className="render-empty"><Icon name="video" size={38} /><h3>Your next creation belongs here.</h3><p>Add some tracks and choose Export video.<br />Your render progress and finished videos will appear here.</p></div>}
      {center.active.length > 0 && <section><h3 className="render-section-title">IN PROGRESS <span>{center.active.length}</span></h3>{[...center.active].reverse().map(job => <RenderCard key={job.id} job={job} />)}</section>}
      {finished.length > 0 && <section><h3 className="render-section-title">RENDER HISTORY <span>{finished.length}</span></h3>{finished.map(job => <RenderCard key={job.id} job={job} />)}</section>}
    </div>
    <div className="render-library-footer"><Icon name="info" size={15} /><span>You can close this tab. Keep the local Wavevo server running and your computer awake.</span></div>
  </dialog>;
}
