"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import { formatTime } from "@/lib/format";
import type { ExportSettings, UploadedTrack } from "@/lib/types";

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["wav", "mp3", "flac"];

export default function Home() {
  const [track, setTrack] = useState<UploadedTrack | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const acceptFile = useCallback(async (file?: File) => {
    if (!file) return;
    setError("");
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !ACCEPTED_EXTENSIONS.includes(extension)) {
      setError("Choose a WAV, MP3, or FLAC audio file.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("That file is larger than the 200 MB limit.");
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append("audio", file);
      const response = await fetch("/api/uploads", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Upload failed.");
      setTrack(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }, []);

  if (track) return <Editor track={track} onReset={() => setTrack(null)} />;

  return (
    <main className="landing-shell">
      <nav className="nav">
        <a className="brand" href="#">wavevo<span>.</span></a>
        <span className="nav-note">Audio into motion</span>
      </nav>

      <section className="hero">
        <div className="eyebrow"><span /> Waveform studio</div>
        <h1>Let your sound<br /><em>take shape.</em></h1>
        <p>Turn any track into a clean, shareable waveform video—without a timeline editor.</p>

        <label
          className={`dropzone ${dragging ? "is-dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            setDragging(false);
            void acceptFile(event.dataTransfer.files[0]);
          }}
        >
          <input
            type="file"
            accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac"
            onChange={(event: ChangeEvent<HTMLInputElement>) => void acceptFile(event.target.files?.[0])}
            disabled={uploading}
          />
          <span className="upload-icon">↗</span>
          <strong>{uploading ? "Preparing your waveform…" : "Drop your audio here"}</strong>
          <span>{uploading ? "This can take a moment for larger files" : "or click to choose a file"}</span>
          <small>WAV, MP3 or FLAC · up to 200 MB</small>
          {uploading && <i className="loading-line" />}
        </label>
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>

      <footer className="landing-footer"><span>Private by default</span><span>Built for sound</span></footer>
    </main>
  );
}

function Editor({ track, onReset }: { track: UploadedTrack; onReset: () => void }) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [counting, setCounting] = useState<number | null>(null);
  const [settings, setSettings] = useState<ExportSettings>({ color: "#ff5c35", showProgress: true, countdown: 3 });
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState("");
  const [error, setError] = useState("");
  const timelineScale = track.duration <= 60
    ? { tick: 1, label: 10 }
    : track.duration <= 300
      ? { tick: 5, label: 30 }
      : track.duration <= 900
        ? { tick: 10, label: 60 }
        : { tick: 30, label: 300 };

  useEffect(() => {
    let active = true;
    async function mount() {
      const [{ default: WaveSurfer }, { default: Timeline }] = await Promise.all([
        import("wavesurfer.js"),
        import("wavesurfer.js/dist/plugins/timeline.esm.js"),
      ]);
      if (!active || !waveformRef.current) return;
      const wave = WaveSurfer.create({
        container: waveformRef.current,
        url: track.audioUrl,
        peaks: [track.peaks],
        duration: track.duration,
        waveColor: settings.color,
        progressColor: settings.showProgress ? "#f4f1e9" : settings.color,
        cursorColor: "#f4f1e9",
        cursorWidth: 2,
        height: 250,
        barWidth: 3,
        barGap: 3,
        barRadius: 3,
        normalize: false,
        plugins: [Timeline.create({
          height: 38,
          timeInterval: timelineScale.tick,
          primaryLabelInterval: timelineScale.label,
          secondaryLabelInterval: timelineScale.label,
          secondaryLabelOpacity: 1,
          formatTimeCallback: formatTime,
          style: {
            color: "#777b83",
            fontSize: "10px",
            borderTop: "1px solid rgba(244, 241, 233, 0.12)",
            marginTop: "18px",
            paddingTop: "9px",
          },
        })],
      });
      wave.on("ready", () => setReady(true));
      wave.on("play", () => setPlaying(true));
      wave.on("pause", () => setPlaying(false));
      wave.on("finish", () => setPlaying(false));
      wave.on("timeupdate", setCurrentTime);
      waveSurferRef.current = wave;
    }
    void mount();
    return () => {
      active = false;
      if (timerRef.current) clearInterval(timerRef.current);
      waveSurferRef.current?.destroy();
      waveSurferRef.current = null;
    };
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    waveSurferRef.current?.setOptions({
      waveColor: settings.color,
      progressColor: settings.showProgress ? "#f4f1e9" : settings.color,
    });
    setExportUrl("");
  }, [settings.color, settings.showProgress, settings.countdown]);

  const togglePlayback = () => {
    const wave = waveSurferRef.current;
    if (!wave || !ready) return;
    if (counting !== null) {
      if (timerRef.current) clearInterval(timerRef.current);
      setCounting(null);
      return;
    }
    if (wave.isPlaying()) {
      wave.pause();
      return;
    }
    if (settings.countdown > 0 && wave.getCurrentTime() < 0.05) {
      let value = settings.countdown;
      setCounting(value);
      timerRef.current = setInterval(() => {
        value -= 1;
        if (value <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setCounting(null);
          void wave.play();
        } else {
          setCounting(value);
        }
      }, 1000);
      return;
    }
    void wave.play();
  };

  const restartPlayback = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setCounting(null);
    waveSurferRef.current?.setTime(0);
    setCurrentTime(0);
  };

  const createExport = async () => {
    setExporting(true);
    setError("");
    setExportUrl("");
    try {
      const response = await fetch("/api/exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId: track.id, ...settings }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Export failed.");
      setExportUrl(payload.downloadUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="studio-shell">
      <nav className="nav studio-nav">
        <button className="brand brand-button" onClick={onReset}>wavevo<span>.</span></button>
        <button className="new-track" onClick={onReset}>＋ New track</button>
      </nav>

      <section className="studio">
        <header className="track-header">
          <div><span className="section-label">Now shaping</span><h1>{track.name}</h1></div>
          <span className="duration-pill">{formatTime(track.duration)}</span>
        </header>

        <div className="canvas-card">
          <div className="wave-glow" style={{ background: settings.color }} />
          <div ref={waveformRef} className="waveform" />
          {counting !== null && <div className="countdown"><span>{counting}</span></div>}
          {!ready && <div className="wave-loading">Drawing waveform…</div>}
        </div>

        <div className="transport">
          <button className="restart" onClick={restartPlayback} disabled={!ready} aria-label="Go back to start" title="Go back to start">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5v14M19 6l-9 6 9 6V6Z" />
            </svg>
            <span>Start</span>
          </button>
          <SkipButton direction="back" onClick={() => waveSurferRef.current?.skip(-10)} disabled={!ready} />
          <button className="play" onClick={togglePlayback} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>
            {counting !== null ? "×" : playing ? "Ⅱ" : "▶"}
          </button>
          <SkipButton direction="forward" onClick={() => waveSurferRef.current?.skip(10)} disabled={!ready} />
          <div className="time-readout"><strong>{formatTime(currentTime)}</strong><span>/ {formatTime(track.duration)}</span></div>
        </div>

        <div className="controls-grid">
          <section className="control-panel">
            <span className="section-label">Appearance</span>
            <div className="control-row">
              <label htmlFor="wave-color">Waveform color</label>
              <div className="color-control"><input id="wave-color" type="color" value={settings.color} onChange={(e) => setSettings({ ...settings, color: e.target.value })} /><code>{settings.color.toUpperCase()}</code></div>
            </div>
            <div className="control-row">
              <div><label htmlFor="progress">Playback progress</label><p>Highlight the played section</p></div>
              <button id="progress" role="switch" aria-checked={settings.showProgress} className={`switch ${settings.showProgress ? "on" : ""}`} onClick={() => setSettings({ ...settings, showProgress: !settings.showProgress })}><span /></button>
            </div>
          </section>

          <section className="control-panel">
            <span className="section-label">Playback</span>
            <div className="control-row countdown-row">
              <div><label htmlFor="countdown">Countdown</label><p>Add a lead-in before audio</p></div>
              <select id="countdown" value={settings.countdown} onChange={(e) => setSettings({ ...settings, countdown: Number(e.target.value) as ExportSettings["countdown"] })}>
                <option value={0}>Off</option><option value={3}>3 sec</option><option value={5}>5 sec</option><option value={10}>10 sec</option>
              </select>
            </div>
          </section>
        </div>

        <section className="export-panel">
          <div><span className="section-label">Export</span><h2>Ready to make it move?</h2><p>MP4 · H.264 · 1080p · with audio</p></div>
          <div className="export-actions">
            {exportUrl && <a className="download-button" href={exportUrl} download={`${track.name.replace(/\.[^.]+$/, "")}-wavevo.mp4`}>Download video</a>}
            <button className="export-button" onClick={() => void createExport()} disabled={exporting}>{exporting ? "Rendering…" : "Export video →"}</button>
          </div>
        </section>
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>
    </main>
  );
}

function SkipButton({ direction, onClick, disabled }: { direction: "back" | "forward"; onClick: () => void; disabled: boolean }) {
  const arrow = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12H4M10 6l-6 6 6 6" />
    </svg>
  );
  return (
    <button className={`skip ${direction}`} onClick={onClick} disabled={disabled} aria-label={`${direction === "back" ? "Back" : "Forward"} 10 seconds`}>
      {direction === "back" && arrow}
      <span>10s</span>
      {direction === "forward" && arrow}
    </button>
  );
}
