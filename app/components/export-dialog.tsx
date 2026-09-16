"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { announceRender } from "./use-render-jobs";
import { formatTime } from "@/lib/format";
import { VIDEO_RESOLUTIONS, type VideoResolution } from "@/lib/video-resolution";
import { VIDEO_QUALITIES, type VideoQuality } from "@/lib/video-quality";
import type { ExportSettings, SessionTrack, StudioRenderSession, VideoFormat } from "@/lib/types";

type StudioView = Pick<StudioRenderSession, "selectedId" | "compact" | "loop" | "snap" | "snapInterval">;

export function ExportDialog({ sessionName, tracks, masterVolume, settings, onSettings, onClose, editorTheme, view }: { sessionName: string; tracks: SessionTrack[]; masterVolume: number; settings: ExportSettings; onSettings: (settings: ExportSettings) => void; onClose: () => void; editorTheme: string; view: StudioView }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<VideoFormat>("mp4");
  const [resolution, setResolution] = useState<VideoResolution>("1080p");
  const [quality, setQuality] = useState<VideoQuality>("high");
  const dimensions = VIDEO_RESOLUTIONS[resolution];
  const [videoTheme, setVideoTheme] = useState(editorTheme);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const anySolo = tracks.some(track => track.solo);
  const audible = tracks.filter(track => !track.muted && (!anySolo || track.solo) && track.volume > 0);
  const duration = Math.max(0, ...tracks.map(track => track.duration + track.start));
  useEffect(() => { ref.current?.showModal(); }, []);
  const changeSettings = (values: Partial<ExportSettings>) => onSettings({ ...settings, ...values });
  const render = async () => {
    setExporting(true); setError("");
    try {
      const response = await fetch("/api/mix-exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionName, tracks: tracks.map(({ id, name, color, volume, pan, muted, solo, start }) => ({ uploadId: id, name, color, volume, pan, muted, solo, start })), masterVolume, ...settings, videoTheme, format, resolution, quality, view }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Export failed.");
      announceRender(payload.job);
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Export failed."); }
    finally { setExporting(false); }
  };
  return <dialog className="export-dialog" ref={ref} onCancel={event => { if (exporting) event.preventDefault(); else onClose(); }} onClick={event => { if (event.target === event.currentTarget && !exporting) onClose(); }} aria-labelledby="export-title">
    <div className="dialog-heading"><span className="eyebrow">AUDIO INTO MOTION</span><button className="icon-button" aria-label="Close export" onClick={onClose} disabled={exporting}><Icon name="close" /></button></div><h2 id="export-title">Your studio, in motion.</h2><p>Export a video of the full studio interface with your session audio.</p>
    <div className="export-summary"><Icon name="wave" size={26} /><div><strong title={sessionName}>{sessionName}</strong><span>{tracks.length} visible {tracks.length === 1 ? "track" : "tracks"} · {formatTime(duration)} · {dimensions.width} × {dimensions.height} · 30 fps</span></div></div>
    <fieldset disabled={exporting} className="export-fields">
      <label>Video format<select value={format} onChange={event => setFormat(event.target.value as VideoFormat)}><option value="mp4">MP4 · H.264 / AAC</option><option value="mov">MOV · H.264 / AAC</option></select></label>
      <label>Resolution<select value={resolution} onChange={event => setResolution(event.target.value as VideoResolution)}>{Object.entries(VIDEO_RESOLUTIONS).map(([value, size]) => <option key={value} value={value}>{size.label} · {size.width} × {size.height}</option>)}</select></label>
      <label>Video quality<select value={quality} aria-describedby="export-quality-help" onChange={event => setQuality(event.target.value as VideoQuality)}>{Object.entries(VIDEO_QUALITIES).map(([value, profile]) => <option key={value} value={value}>{profile.label}</option>)}</select></label>
      <label>Interface theme<select value={videoTheme} onChange={event => setVideoTheme(event.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label>Countdown<select value={settings.countdown} onChange={event => changeSettings({ countdown: Number(event.target.value) as ExportSettings["countdown"] })}><option value={0}>None</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></label>
      <label className="export-progress">Moving playhead<input type="checkbox" checked={settings.showProgress} onChange={event => changeSettings({ showProgress: event.target.checked })} /></label>
    </fieldset>
    <p id="export-quality-help" className="export-quality-note" aria-live="polite">{VIDEO_QUALITIES[quality].description}</p>
    {resolution === "4k" && <p className="export-resolution-note">4K gives you sharper detail with larger files and longer render times.</p>}
    <p className="export-note">Includes every track lane, its color and name, the timeline, controls, clock, and live meters. The full session fits in the frame; your audio follows the track and master settings.</p>
    <p className="export-background-note"><Icon name="info" size={15} /> Keep editing after you start. This video uses your current session settings; follow its progress in Videos.</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="secondary-button" disabled={exporting} onClick={onClose}>Back to session</button><button className="primary-button" disabled={exporting || !audible.length || masterVolume === 0} onClick={() => void render()}>{exporting ? <><span className="spinner" /> Queuing…</> : <><Icon name="play" size={15} /> Render in background</>}</button></div>
    {masterVolume === 0 && <p className="dialog-error">Raise the master volume to export your session.</p>}
    {exporting && <p className="render-status" role="status">Saving this session to the render queue…</p>}
  </dialog>;
}
