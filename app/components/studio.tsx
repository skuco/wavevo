"use client";

import { CSSProperties, PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { SnapHelp } from "./snap-help";
import { SessionTitle } from "./session-title";
import { Waveform } from "./waveform";
import { useTransport } from "./use-transport";
import { formatTime } from "@/lib/format";
import { VIDEO_RESOLUTIONS, type VideoResolution } from "@/lib/video-resolution";
import type { ExportSettings, SessionTrack, StudioRenderSession, VideoFormat, WaveformDensity, WaveformStyle } from "@/lib/types";

const COLORS = ["#18c9a7", "#26c4db", "#ac89f5", "#efad64", "#ed88ad", "#8bca76"];
const ACCEPT = ".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac";
const STYLES: Record<WaveformStyle, string> = { wave: "Classic wave", rounded: "Rounded bars", square: "Square bars", particles: "Particles" };
const DENSITIES: Record<WaveformDensity, string> = { low: "Low", medium: "Medium", high: "High" };
const db = (value: number) => value === 0 ? "−∞" : `${(20 * Math.log10(value)).toFixed(1)}`;
const timecode = (value: number) => `${String(Math.floor(value / 3600)).padStart(2, "0")}h${String(Math.floor(value / 60) % 60).padStart(2, "0")}m${(value % 60).toFixed(2).padStart(5, "0")}s`;
const trackLabel = (track: SessionTrack) => track.name.replace(/\.[^.]+$/, "");

const NO_TRACKS: SessionTrack[] = [];

export default function Studio({ renderSession }: { renderSession?: StudioRenderSession }) {
  const [tracks, setTracks] = useState<SessionTrack[]>(renderSession?.tracks || []);
  const [sessionName, setSessionName] = useState(renderSession?.sessionName || "Untitled session");
  const [selectedId, setSelectedId] = useState(renderSession?.selectedId || "");
  const [theme, setTheme] = useState(renderSession?.settings.videoTheme || "dark");
  const [renderTime, setRenderTime] = useState(-(renderSession?.settings.countdown || 0));
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loop, setLoop] = useState(renderSession?.loop || false);
  const [snap, setSnap] = useState(renderSession?.snap || false);
  const [snapInterval, setSnapInterval] = useState(renderSession?.snapInterval || 1);
  const [zoom, setZoom] = useState(1);
  const [compact, setCompact] = useState(renderSession?.compact || false);
  const [masterVolume, setMasterVolume] = useState(renderSession?.masterVolume ?? 0.8);
  const [settings, setSettings] = useState<ExportSettings>(renderSession?.settings || { color: COLORS[0], showProgress: true, countdown: 0, waveformStyle: "wave", waveformDensity: "high", videoTheme: "dark" });
  const [exportOpen, setExportOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const uploadLock = useRef(false);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const dragDepth = useRef(0);
  const clipDrag = useRef<{ id: string; x: number; start: number; scale: number } | null>(null);
  const liveTransport = useTransport(renderSession ? NO_TRACKS : tracks, masterVolume, loop);
  const transport = renderSession ? {
    ...liveTransport,
    ready: true,
    playing: renderTime >= 0,
    currentTime: Math.max(0, renderTime),
    duration: Math.max(0, ...tracks.map(track => track.start + track.duration)),
    levels: Object.fromEntries(renderSession.tracks.map(track => {
      const active = !track.muted && (!tracks.some(candidate => candidate.solo) || track.solo);
      const index = Math.floor((renderTime - track.start) * 30);
      return [track.id, active && renderTime >= track.start ? track.meterPeaks[index] || 0 : 0];
    })),
  } : liveTransport;
  const selected = tracks.find(track => track.id === selectedId) || tracks[0];
  const anySolo = tracks.some(track => track.solo);
  const audible = tracks.filter(track => !track.muted && (!anySolo || track.solo) && track.volume > 0);
  const timelineDuration = Math.max(30, Math.ceil(transport.duration / 5) * 5);
  const timelineWidth = Math.max(300, viewportWidth - 32) * zoom;
  const pixelsPerSecond = timelineWidth / timelineDuration;
  const tickStep = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find(step => step * pixelsPerSecond >= 95) || 3600;
  const ticks = Array.from({ length: Math.floor(timelineDuration / tickStep) + 1 }, (_, index) => index * tickStep);
  const updateTrack = useCallback((id: string, values: Partial<SessionTrack>) => setTracks(previous => previous.map(track => track.id === id ? { ...track, ...values } : track)), []);

  useEffect(() => {
    const saved = renderSession?.settings.videoTheme || (localStorage.getItem("wavevo-theme") === "light" ? "light" : "dark");
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, [renderSession]);

  useEffect(() => {
    if (!renderSession) return;
    const frame = (event: Event) => setRenderTime((event as CustomEvent<number>).detail);
    window.addEventListener("wavevo:render-frame", frame);
    document.documentElement.dataset.studioRender = "ready";
    return () => {
      window.removeEventListener("wavevo:render-frame", frame);
      delete document.documentElement.dataset.studioRender;
    };
  }, [renderSession]);

  useEffect(() => {
    if (!viewportRef.current) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("wavevo-theme", next);
    document.documentElement.dataset.theme = next;
  };

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length || uploadLock.current) return;
    uploadLock.current = true;
    transport.pause();
    const errors: string[] = [];
    setError("");
    const available = Math.max(0, 32 - tracksRef.current.length);
    if (files.length > available) errors.push("A session can contain up to 32 tracks.");
    try {
      for (const [index, file] of files.slice(0, available).entries()) {
        if (!/\.(wav|mp3|flac)$/i.test(file.name)) { errors.push(`${file.name}: choose a WAV, MP3, or FLAC file.`); continue; }
        if (file.size > 200 * 1024 * 1024) { errors.push(`${file.name} is larger than 200 MB.`); continue; }
        setUploading(`Preparing ${index + 1} of ${Math.min(files.length, available)} · ${file.name}`);
        try {
          const body = new FormData();
          body.append("audio", file);
          const response = await fetch("/api/uploads", { method: "POST", body });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Upload failed.");
          setTracks(previous => [...previous, { ...payload, channelPeaks: payload.channelPeaks || [payload.peaks], color: COLORS[previous.length % COLORS.length], volume: 0.8, pan: 0, muted: false, solo: false, start: 0 }]);
          setSelectedId(payload.id);
        } catch (caught) { errors.push(caught instanceof Error ? caught.message : "Upload failed."); }
      }
    } finally { setUploading(""); uploadLock.current = false; setError(errors.join(" ")); }
  }, [transport.pause]);

  const togglePlayback = useCallback(() => {
    if (transport.playing) transport.pause();
    else if (!uploadLock.current) void transport.play();
  }, [transport.playing, transport.pause, transport.play]);
  const stop = useCallback(() => { transport.pause(); transport.seek(0); }, [transport.pause, transport.seek]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.closest("input, select, textarea, button, a, dialog") || event.target.isContentEditable)) return;
      if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
      if (event.code === "Home") { event.preventDefault(); transport.seek(0); }
      if (event.code === "Escape") stop();
      if (event.code === "ArrowRight" || event.code === "ArrowLeft") { event.preventDefault(); transport.seek(transport.currentTime + (event.code === "ArrowRight" ? 5 : -5)); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [togglePlayback, stop, transport.seek, transport.currentTime]);

  useEffect(() => {
    if (!transport.playing || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const x = transport.currentTime * pixelsPerSecond;
    if (x > viewport.scrollLeft + viewport.clientWidth - 32 || x < viewport.scrollLeft) viewport.scrollLeft = Math.max(0, x - 60);
  }, [transport.currentTime, transport.playing, pixelsPerSecond]);

  const seekPointer = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const seconds = (event.clientX - rect.left) / pixelsPerSecond;
    transport.seek(snap ? Math.round(seconds / snapInterval) * snapInterval : seconds);
  };

  const removeTrack = (id: string) => {
    transport.pause();
    const next = tracks.filter(track => track.id !== id);
    setTracks(next);
    setSelectedId(next[0]?.id || "");
    transport.seek(Math.min(transport.currentTime, Math.max(0, ...next.map(track => track.duration + track.start))));
  };

  return (
    <main className={`studio-shell ${compact ? "compact" : ""} ${renderSession ? "studio-render" : ""}`}
      onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDragLeave={event => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }}
      onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}>
      <input ref={inputRef} className="visually-hidden" type="file" accept={ACCEPT} multiple onChange={event => { void addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} aria-label="Add audio files" disabled={!!uploading} />
      <header className="app-header">
        <a className="brand" href="/" aria-label="Wavevo home"><span className="brand-mark"><Icon name="wave" size={22} /></span>wavevo<span className="brand-dot">.</span></a>
        <span className="header-divider" />
        <div className="workspace-label">Audio studio <span>Multitrack</span></div>
        <div className="header-actions"><span className="session-tag"><i /> Local session</span><button className="icon-button theme-button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title="Change theme"><Icon name={theme === "dark" ? "sun" : "moon"} /></button><button className="primary-button" onClick={() => { transport.pause(); setExportOpen(true); }} disabled={!audible.length || !!uploading}><Icon name="download" size={16} /> Export video</button></div>
      </header>

      <section className="toolbar" aria-label="Playback and timeline controls">
        <div className="transport-buttons">
          <button className={`icon-button play-button ${transport.playing ? "is-playing" : ""}`} onClick={togglePlayback} disabled={!transport.ready || !!uploading} aria-label={transport.playing ? "Pause" : "Play"} title="Play / pause · Space"><Icon name={transport.playing ? "pause" : "play"} size={20} /></button>
          <button className="icon-button" onClick={stop} disabled={!tracks.length} aria-label="Stop" title="Stop · Esc"><Icon name="stop" /></button>
          <button className="icon-button" onClick={() => transport.seek(0)} disabled={!tracks.length} aria-label="Go to start" title="Go to start · Home"><Icon name="start" /></button>
          <button className="icon-button" onClick={() => transport.seek(transport.duration)} disabled={!tracks.length} aria-label="Go to end" title="Go to end"><Icon name="end" /></button>
          <button className={`icon-button ${loop ? "active" : ""}`} onClick={() => setLoop(!loop)} aria-label="Loop playback" aria-pressed={loop} title="Loop playback"><Icon name="loop" /></button>
        </div>
        <span className="toolbar-divider" />
        <div className="time-display" aria-label={`Playhead ${timecode(transport.currentTime)}`}><span className="time-label">PLAYHEAD</span><output>{timecode(transport.currentTime)}</output></div>
        <span className="toolbar-divider" />
        <div className="snap-controls">
          <label className="snap-toggle"><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} /> Snap</label>
          <SnapHelp />
          <select className="snap-select" aria-label="Snap interval" value={snapInterval} disabled={!snap} onChange={event => setSnapInterval(Number(event.target.value))}><option value={1}>1 second</option><option value={0.5}>½ second</option><option value={0.1}>0.1 second</option></select>
        </div>
        <div className="zoom-controls"><button className="icon-button" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom / 1.5))} aria-label="Zoom out" title="Zoom out"><Icon name="zoomOut" /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" disabled={zoom >= 8} onClick={() => setZoom(Math.min(8, zoom * 1.5))} aria-label="Zoom in" title="Zoom in"><Icon name="zoomIn" /></button><button className="icon-button" onClick={() => { setZoom(1); if (viewportRef.current) viewportRef.current.scrollLeft = 0; }} aria-label="Fit session to view" title="Fit session"><Icon name="fit" /></button></div>
      </section>

      <section className="session-heading"><div><SessionTitle value={sessionName} onChange={setSessionName} readOnly={!!renderSession} /><span>{tracks.length} {tracks.length === 1 ? "track" : "tracks"}<b>·</b>{formatTime(transport.duration)} duration</span></div><div className="session-heading-actions"><span className="timeline-hint">Drag a clip header to move it</span><button className={`icon-button ${compact ? "active" : ""}`} onClick={() => setCompact(!compact)} aria-label="Compact track height" aria-pressed={compact} title="Compact tracks"><Icon name="grid" size={16} /></button></div></section>

      {(error || transport.error) && <div className="error-banner" role="alert"><span>{error || transport.error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => { setError(""); transport.clearError(); }}><Icon name="close" size={16} /></button></div>}
      {uploading && <div className="upload-status" role="status"><span className="spinner" />{uploading}</div>}

      <section className="arrangement" aria-label="Multitrack arrangement">
        <aside className="track-sidebar" aria-label="Track controls">
          <div className="tracks-heading"><span>Tracks <b>{String(tracks.length).padStart(2, "0")}</b></span><button className="add-track-button" disabled={!!uploading || tracks.length >= 32} onClick={() => inputRef.current?.click()}><Icon name="plus" size={16} /> Add track</button></div>
          {tracks.map((track, index) => {
            const dimmed = track.muted || (anySolo && !track.solo);
            return <div key={track.id} className={`track-strip ${selected?.id === track.id ? "selected" : ""}`} style={{ "--track-color": track.color } as CSSProperties} onClick={() => setSelectedId(track.id)}>
              <div className="track-strip-content">
                <div className="track-name-row"><span className="track-number">{String(index + 1).padStart(2, "0")}</span><Icon name="music" size={16} /><input aria-label={`Track ${index + 1} name`} value={trackLabel(track)} onChange={event => updateTrack(track.id, { name: event.target.value + (track.name.match(/\.[^.]+$/)?.[0] || ".wav") })} onBlur={() => { if (!trackLabel(track).trim()) updateTrack(track.id, { name: `Audio ${index + 1}.wav` }); }} /><button className="icon-button remove-track" onClick={() => removeTrack(track.id)} aria-label={`Remove ${trackLabel(track)}`} title="Remove track"><Icon name="close" size={14} /></button></div>
                <div className="track-type"><span className="color-dot" />{track.channelPeaks?.length === 2 ? "Stereo" : "Mono"} audio<span>{formatTime(track.duration)}</span></div>
                <div className="track-volume-row"><Icon name="speaker" size={15} /><input type="range" min="0" max="1" step="0.01" value={track.volume} aria-label={`${trackLabel(track)} volume`} onChange={event => updateTrack(track.id, { volume: Number(event.target.value) })} style={{ "--range-fill": `${track.volume * 100}%` } as CSSProperties} /><output>{db(track.volume)} <small>dB</small></output></div>
                <div className="track-bottom-row"><label className="pan-control"><span>L</span><input type="range" min="-1" max="1" step="0.01" value={track.pan} onChange={event => updateTrack(track.id, { pan: Number(event.target.value) })} onDoubleClick={() => updateTrack(track.id, { pan: 0 })} aria-label={`${trackLabel(track)} pan`} title={`${track.pan === 0 ? "Center" : `${Math.round(Math.abs(track.pan) * 100)}% ${track.pan < 0 ? "left" : "right"}`} · Double-click to center`} /><span>R</span></label><button className={`mute-solo ${track.muted ? "muted" : ""}`} aria-label={`Mute ${trackLabel(track)}`} aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })} title="Mute">M</button><button className={`mute-solo ${track.solo ? "solo" : ""}`} aria-label={`Solo ${trackLabel(track)}`} aria-pressed={track.solo} onClick={() => updateTrack(track.id, { solo: !track.solo })} title="Solo">S</button></div>
              </div>
              <div className={`level-meter ${dimmed ? "silent" : ""}`} aria-label={`${trackLabel(track)} level ${Math.round((transport.levels[track.id] || 0) * 100)}%`}><div style={{ transform: `scaleY(${Math.min(1, Math.sqrt(transport.levels[track.id] || 0))})` }} /></div>
            </div>;
          })}
          {!!tracks.length && <button className="sidebar-add" disabled={!!uploading || tracks.length >= 32} onClick={() => inputRef.current?.click()}><Icon name="plus" size={17} /> Add another track</button>}
          <div className="sidebar-note"><Icon name="headphones" size={16} /><span>A little space for<br />your next big sound.</span></div>
        </aside>

        <div ref={viewportRef} className="timeline-viewport">
          <div className="timeline-content" style={{ width: timelineWidth + 32, "--grid-size": `${tickStep * pixelsPerSecond}px`, "--minor-grid-size": `${tickStep * pixelsPerSecond / 5}px` } as CSSProperties}>
            <div className="timeline-ruler" role="slider" aria-label="Timeline playhead" aria-valuemin={0} aria-valuemax={transport.duration} aria-valuenow={Number(transport.currentTime.toFixed(2))} aria-valuetext={timecode(transport.currentTime)} tabIndex={0} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); seekPointer(event); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekPointer(event); }} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); transport.seek(transport.currentTime + (event.key === "ArrowRight" ? 1 : -1) * (snap ? snapInterval : 1)); } }}>
              {ticks.map(time => <span key={time} className="timeline-tick" style={{ left: time * pixelsPerSecond }}>{tickStep < 1 ? `${formatTime(time)}.${Math.round((time % 1) * 10)}` : formatTime(time)}</span>)}
            </div>
            <div className="timeline-lanes" onPointerDown={event => { if (event.target === event.currentTarget) seekPointer(event); }}>
              {tracks.map(track => <div key={track.id} className={`track-lane ${selected?.id === track.id ? "selected" : ""}`} onPointerDown={event => { if (event.target === event.currentTarget) seekPointer(event); }}>
                <div className={`audio-clip ${track.muted || (anySolo && !track.solo) ? "clip-muted" : ""} ${selected?.id === track.id ? "selected" : ""}`} style={{ left: track.start * pixelsPerSecond, width: Math.max(3, track.duration * pixelsPerSecond), "--track-color": track.color } as CSSProperties} onClick={() => setSelectedId(track.id)}>
                  <div className="clip-header" title="Drag to move track" onPointerDown={event => { event.stopPropagation(); transport.pause(); setSelectedId(track.id); event.currentTarget.setPointerCapture(event.pointerId); clipDrag.current = { id: track.id, x: event.clientX, start: track.start, scale: pixelsPerSecond }; }} onPointerMove={event => { const drag = clipDrag.current; if (!drag || drag.id !== track.id || !event.currentTarget.hasPointerCapture(event.pointerId)) return; let start = Math.max(0, Math.min(86400, drag.start + (event.clientX - drag.x) / drag.scale)); if (snap) start = Math.round(start / snapInterval) * snapInterval; updateTrack(track.id, { start: Math.round(start * 100) / 100 }); }} onPointerUp={() => { clipDrag.current = null; }} onPointerCancel={() => { clipDrag.current = null; }}><span><Icon name="wave" size={12} />{trackLabel(track)}</span><span className="clip-duration">{formatTime(track.duration)}</span></div>
                  <div className="clip-body" onPointerDown={event => { event.stopPropagation(); const clip = event.currentTarget.getBoundingClientRect(); const time = track.start + (event.clientX - clip.left) / pixelsPerSecond; transport.seek(snap ? Math.round(time / snapInterval) * snapInterval : time); }}><Waveform channels={track.channelPeaks!} style={settings.waveformStyle} density={settings.waveformDensity} /></div>
                </div>
              </div>)}
              {!!tracks.length && <button className="timeline-add" disabled={!!uploading || tracks.length >= 32} onClick={() => inputRef.current?.click()} style={{ width: Math.max(200, viewportWidth - 64) }}><Icon name="plus" size={18} /><span>Drop audio here to add a track</span><small>WAV, MP3, FLAC</small></button>}
            </div>
            {!!tracks.length && (!renderSession || settings.showProgress) && <div className="playhead" style={{ left: Math.min(timelineWidth, transport.currentTime * pixelsPerSecond) }}><span /></div>}
          </div>
          {!tracks.length && <div className="empty-session"><span className="empty-icon"><Icon name="wave" size={32} /></span><span className="eyebrow">YOUR SESSION STARTS HERE</span><h2>Bring your tracks together.</h2><p>Drop in your audio, find the balance,<br />and give your sound a little color.</p><button className="primary-button" disabled={!!uploading} onClick={() => inputRef.current?.click()}><Icon name="plus" size={17} /> Add your first tracks</button><span className="file-types">WAV, MP3 or FLAC · Up to 200 MB per file</span><button className="demo-button" disabled={!!uploading} onClick={async () => { const { createDemoFiles } = await import("@/lib/demo"); void addFiles(createDemoFiles()); }}>Try a demo session <Icon name="chevron" size={13} /></button></div>}
        </div>
        {renderSession && renderTime < 0 && <div className="render-countdown">Starting in <strong>{Math.ceil(-renderTime)}</strong></div>}
      </section>

      <section className="inspector" aria-label="Waveform appearance">
        <div className="inspector-title"><Icon name="sliders" size={17} /><div><h2>Track appearance</h2><span>{selected ? trackLabel(selected) : "Select a track to customize"}</span></div></div>
        <div className="inspector-field color-field"><label htmlFor="track-color">Track color</label><div className="color-swatches">{COLORS.map(color => <button key={color} className={`color-swatch ${selected?.color === color ? "chosen" : ""}`} disabled={!selected} style={{ background: color }} aria-label={`Set track color ${color}`} aria-pressed={selected?.color === color} onClick={() => selected && updateTrack(selected.id, { color })}>{selected?.color === color && <Icon name="check" size={12} />}</button>)}<label className="custom-color" title="Custom track color"><input id="track-color" type="color" value={selected?.color || COLORS[0]} disabled={!selected} onChange={event => selected && updateTrack(selected.id, { color: event.target.value })} /><Icon name="plus" size={13} /></label></div></div>
        <label className="inspector-field">Waveform style · all tracks<select value={settings.waveformStyle} onChange={event => setSettings({ ...settings, waveformStyle: event.target.value as WaveformStyle })}>{Object.entries(STYLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="inspector-field density-field">Detail · all tracks<select value={settings.waveformDensity} onChange={event => setSettings({ ...settings, waveformDensity: event.target.value as WaveformDensity })}>{Object.entries(DENSITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="inspector-field offset-field">Start time <span className="number-input"><input type="number" min="0" max="86400" step={snap ? snapInterval : 0.1} value={selected?.start || 0} disabled={!selected} onChange={event => { transport.pause(); if (selected) updateTrack(selected.id, { start: Math.max(0, Math.min(86400, Number(event.target.value))) }); }} aria-label="Selected track start time" /><span>sec</span></span></label>
        <div className="master-volume"><label htmlFor="master-volume"><Icon name="speaker" size={16} />Master<output>{Math.round(masterVolume * 100)}%</output></label><input id="master-volume" type="range" min="0" max="1" step="0.01" value={masterVolume} onChange={event => setMasterVolume(Number(event.target.value))} style={{ "--range-fill": `${masterVolume * 100}%` } as CSSProperties} /></div>
      </section>

      <footer className="status-bar"><span className="status-indicator"><i className={transport.playing ? "playing" : ""} />{uploading ? "Importing audio" : tracks.length && !transport.ready ? "Preparing playback" : renderSession && renderTime < 0 ? "Counting in" : transport.playing ? "Playing" : "Ready"}<span className="footer-separator">/</span>{audible.length} {audible.length === 1 ? "track" : "tracks"} audible</span><div className="keyboard-hints"><span><kbd>space</kbd> play / pause</span><span><kbd>←</kbd><kbd>→</kbd> seek</span></div><span className="footer-credit">Audio into motion<span>·</span><a href="https://www.testx.sk" target="_blank" rel="noreferrer">testx</a></span></footer>
      {dragging && <div className="drop-overlay"><Icon name="upload" size={40} /><h2>Add to your session</h2><p>Drop your audio files anywhere</p></div>}
      {exportOpen && <ExportDialog sessionName={sessionName} tracks={tracks} masterVolume={masterVolume} settings={{ ...settings, color: selected?.color || COLORS[0] }} onSettings={setSettings} editorTheme={theme} view={{ selectedId: selected?.id || "", compact, loop, snap, snapInterval }} onClose={() => setExportOpen(false)} />}
    </main>
  );
}

type StudioView = Pick<StudioRenderSession, "selectedId" | "compact" | "loop" | "snap" | "snapInterval">;

function ExportDialog({ sessionName, tracks, masterVolume, settings, onSettings, onClose, editorTheme, view }: { sessionName: string; tracks: SessionTrack[]; masterVolume: number; settings: ExportSettings; onSettings: (settings: ExportSettings) => void; onClose: () => void; editorTheme: string; view: StudioView }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<VideoFormat>("mp4");
  const [resolution, setResolution] = useState<VideoResolution>("1080p");
  const dimensions = VIDEO_RESOLUTIONS[resolution];
  const [videoTheme, setVideoTheme] = useState(editorTheme);
  const [exporting, setExporting] = useState(false);
  const [download, setDownload] = useState("");
  const [error, setError] = useState("");
  const anySolo = tracks.some(track => track.solo);
  const audible = tracks.filter(track => !track.muted && (!anySolo || track.solo) && track.volume > 0);
  const duration = Math.max(0, ...tracks.map(track => track.duration + track.start));
  useEffect(() => { ref.current?.showModal(); }, []);
  const changeSettings = (values: Partial<ExportSettings>) => { onSettings({ ...settings, ...values }); setDownload(""); };
  const render = async () => {
    setExporting(true); setError(""); setDownload("");
    try {
      const response = await fetch("/api/mix-exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionName, tracks: tracks.map(({ id, name, color, volume, pan, muted, solo, start }) => ({ uploadId: id, name, color, volume, pan, muted, solo, start })), masterVolume, ...settings, videoTheme, format, resolution, view }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Export failed.");
      setDownload(payload.downloadUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Export failed."); }
    finally { setExporting(false); }
  };
  return <dialog className="export-dialog" ref={ref} onCancel={event => { if (exporting) event.preventDefault(); else onClose(); }} onClick={event => { if (event.target === event.currentTarget && !exporting) onClose(); }} aria-labelledby="export-title">
    <div className="dialog-heading"><span className="eyebrow">AUDIO INTO MOTION</span><button className="icon-button" aria-label="Close export" onClick={onClose} disabled={exporting}><Icon name="close" /></button></div><h2 id="export-title">Your studio, in motion.</h2><p>Export a video of the full studio interface with your session audio.</p>
    <div className="export-summary"><Icon name="wave" size={26} /><div><strong title={sessionName}>{sessionName}</strong><span>{tracks.length} visible {tracks.length === 1 ? "track" : "tracks"} · {formatTime(duration)} · {dimensions.width} × {dimensions.height} · 30 fps</span></div></div>
    <fieldset disabled={exporting} className="export-fields">
      <label>Video format<select value={format} onChange={event => { setFormat(event.target.value as VideoFormat); setDownload(""); }}><option value="mp4">MP4 · H.264 / AAC</option><option value="mov">MOV · H.264 / AAC</option></select></label>
      <label>Resolution<select value={resolution} onChange={event => { setResolution(event.target.value as VideoResolution); setDownload(""); }}>{Object.entries(VIDEO_RESOLUTIONS).map(([value, size]) => <option key={value} value={value}>{size.label} · {size.width} × {size.height}</option>)}</select></label>
      <label>Interface theme<select value={videoTheme} onChange={event => { setVideoTheme(event.target.value); setDownload(""); }}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label>Countdown<select value={settings.countdown} onChange={event => changeSettings({ countdown: Number(event.target.value) as ExportSettings["countdown"] })}><option value={0}>None</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></label>
      <label className="export-progress">Moving playhead<input type="checkbox" checked={settings.showProgress} onChange={event => changeSettings({ showProgress: event.target.checked })} /></label>
    </fieldset>
    {resolution === "4k" && <p className="export-resolution-note">4K gives you sharper detail with larger files and longer render times.</p>}
    <p className="export-note">Includes every track lane, its color and name, the timeline, controls, clock, and live meters. The full session fits in the frame; your audio follows the track and master settings.</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="secondary-button" disabled={exporting} onClick={onClose}>Back to session</button>{download ? <a className="primary-button" href={download} download><Icon name="download" size={16} /> Download video</a> : <button className="primary-button" disabled={exporting || !audible.length || masterVolume === 0} onClick={() => void render()}>{exporting ? <><span className="spinner" /> Rendering…</> : <><Icon name="play" size={15} /> Render video</>}</button>}</div>
    {masterVolume === 0 && <p className="dialog-error">Raise the master volume to export your session.</p>}
    {exporting && <p className="render-status" role="status">Creating your video. Longer sessions can take a few minutes.</p>}
  </dialog>;
}
