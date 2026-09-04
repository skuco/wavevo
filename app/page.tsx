"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import { formatTime } from "@/lib/format";
import type { ExportSettings, UploadedTrack, VideoFormat, VideoTheme, WaveformDensity, WaveformStyle } from "@/lib/types";

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["wav", "mp3", "flac"];
type Theme = "dark" | "light";

const VIDEO_FORMATS: Record<VideoFormat, { label: string }> = {
  mp4: { label: "MP4 · H.264 / AAC" },
  mov: { label: "MOV · H.264 / AAC" },
};

const WAVEFORM_STYLES: Record<WaveformStyle, string> = {
  rounded: "Rounded bars",
  square: "Square bars",
  particles: "Particles",
  wave: "Classic wave",
};

const WAVEFORM_DENSITIES: Record<WaveformDensity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function shapeAmplitude(value: number) {
  return Math.pow(Math.max(0, Math.min(1, Math.abs(value))), 1.65);
}

function particleRenderer(density: WaveformDensity) {
  return (channels: Array<Float32Array | number[]>, context: CanvasRenderingContext2D) => {
    const peaks = channels[0];
    if (!peaks?.length) return;
    const { width, height } = context.canvas;
    const spacing = density === "low" ? 12 : density === "high" ? 5 : 8;
    const radius = density === "low" ? 2.4 : density === "high" ? 1.4 : 1.9;
    const center = height / 2;
    context.beginPath();
    for (let x = spacing / 2; x < width; x += spacing) {
      const peak = shapeAmplitude(peaks[Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length))] || 0);
      const amplitude = Math.max(spacing / 2, peak * height * 0.27);
      for (let y = center - amplitude; y <= center + amplitude; y += spacing) {
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    context.fill();
    context.closePath();
  };
}

function classicWaveRenderer(density: WaveformDensity) {
  return (channels: Array<Float32Array | number[]>, context: CanvasRenderingContext2D) => {
    const peaks = channels[0];
    if (!peaks?.length) return;
    const { width, height } = context.canvas;
    const requestedPoints = density === "low" ? 160 : density === "high" ? 720 : 360;
    const pointCount = Math.max(2, Math.min(requestedPoints, peaks.length, Math.floor(width)));
    const amplitudes = Array.from({ length: pointCount }, (_, point) => {
      const start = Math.floor((point / pointCount) * peaks.length);
      const end = Math.max(start + 1, Math.floor(((point + 1) / pointCount) * peaks.length));
      let maximum = 0;
      for (let source = start; source < end; source += 1) maximum = Math.max(maximum, Math.abs(peaks[source] || 0));
      return shapeAmplitude(maximum);
    });
    const smoothingRadius = density === "low" ? 2 : density === "medium" ? 1 : 0;
    const smoothed = amplitudes.map((_, point) => {
      let total = 0;
      let samples = 0;
      for (let offset = -smoothingRadius; offset <= smoothingRadius; offset += 1) {
        const index = Math.max(0, Math.min(amplitudes.length - 1, point + offset));
        total += amplitudes[index];
        samples += 1;
      }
      return total / samples;
    });
    const center = height / 2;
    const halfHeight = height * 0.27;
    context.beginPath();
    smoothed.forEach((amplitude, point) => {
      const x = (point / (pointCount - 1)) * width;
      const y = center - Math.max(1, amplitude * halfHeight);
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    for (let point = pointCount - 1; point >= 0; point -= 1) {
      const x = (point / (pointCount - 1)) * width;
      context.lineTo(x, center + Math.max(1, smoothed[point] * halfHeight));
    }
    context.closePath();
    context.fill();
  };
}

function barRenderer(style: "rounded" | "square", density: WaveformDensity) {
  return (channels: Array<Float32Array | number[]>, context: CanvasRenderingContext2D) => {
    const peaks = channels[0];
    if (!peaks?.length) return;
    const { width, height } = context.canvas;
    const slotWidth = density === "low" ? 8 : density === "high" ? 2 : 4;
    const fillRatio = density === "low" ? 0.5 : density === "high" ? 0.72 : 0.62;
    const bars = Math.max(1, Math.min(peaks.length, Math.floor(width / slotWidth)));
    const center = height / 2;
    const maxHeight = height * 0.54;
    for (let bar = 0; bar < bars; bar += 1) {
      const start = Math.floor((bar / bars) * peaks.length);
      const end = Math.max(start + 1, Math.floor(((bar + 1) / bars) * peaks.length));
      let maximum = 0;
      for (let source = start; source < end; source += 1) maximum = Math.max(maximum, Math.abs(peaks[source] || 0));
      const barHeight = Math.max(2, shapeAmplitude(maximum) * maxHeight);
      const x = (bar / bars) * width;
      const barWidth = Math.max(1, (fillRatio / bars) * width);
      const y = center - barHeight / 2;
      context.beginPath();
      if (style === "rounded") context.roundRect(x, y, barWidth, barHeight, Math.min(barWidth / 2, barHeight / 2));
      else context.rect(x, y, barWidth, barHeight);
      context.fill();
    }
  };
}

function waveformRenderOptions(style: WaveformStyle, density: WaveformDensity) {
  if (style === "particles") return { barWidth: undefined, barGap: undefined, barRadius: undefined, renderFunction: particleRenderer(density) };
  if (style === "wave") return { barWidth: undefined, barGap: undefined, barRadius: undefined, renderFunction: classicWaveRenderer(density) };
  return { barWidth: undefined, barGap: undefined, barRadius: undefined, renderFunction: barRenderer(style, density) };
}

function safeExportName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim() || "wavevo-export";
}

export default function Home() {
  const [track, setTrack] = useState<UploadedTrack | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("wavevo-theme");
    const initialTheme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("wavevo-theme", nextTheme);
  };

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

  if (track) return <Editor track={track} onReset={() => setTrack(null)} theme={theme} onToggleTheme={toggleTheme} />;

  return (
    <main className="landing-shell">
      <nav className="nav">
        <a className="brand" href="#">wavevo<span>.</span></a>
        <div className="nav-actions"><span className="nav-note">Audio into motion</span><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
      </nav>

      <section className="hero">
        <div className="eyebrow"><span /> Waveform studio</div>
        <h1>Let your sound<br /><em>take shape.</em></h1>
        <p>Turn any track into a clean, shareable waveform video.</p>

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

      <AppFooter />
    </main>
  );
}

function Editor({ track, onReset, theme, onToggleTheme }: { track: UploadedTrack; onReset: () => void; theme: Theme; onToggleTheme: () => void }) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [counting, setCounting] = useState<number | null>(null);
  const [settings, setSettings] = useState<ExportSettings>({ color: "#ff5c35", showProgress: true, countdown: 3, waveformStyle: "rounded", waveformDensity: "medium", videoTheme: "dark" });
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState("");
  const [videoFormat, setVideoFormat] = useState<VideoFormat>("mp4");
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
        progressColor: settings.showProgress ? (theme === "dark" ? "#f4f1e9" : "#17191d") : settings.color,
        cursorColor: theme === "dark" ? "#f4f1e9" : "#17191d",
        cursorWidth: 2,
        height: 250,
        ...waveformRenderOptions(settings.waveformStyle, settings.waveformDensity),
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
      progressColor: settings.showProgress ? (theme === "dark" ? "#f4f1e9" : "#17191d") : settings.color,
      cursorColor: theme === "dark" ? "#f4f1e9" : "#17191d",
      ...waveformRenderOptions(settings.waveformStyle, settings.waveformDensity),
    });
    setExportUrl("");
  }, [settings.color, settings.showProgress, settings.countdown, settings.waveformStyle, settings.waveformDensity, settings.videoTheme, theme]);

  useEffect(() => {
    setExportUrl("");
  }, [videoFormat]);

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
        body: JSON.stringify({ uploadId: track.id, ...settings, format: videoFormat }),
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
        <div className="nav-actions"><button className="new-track" onClick={onReset}>＋ New track</button><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
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
              <div><label htmlFor="wave-style">Waveform style</label><p>Choose the shape of the visualization</p></div>
              <select id="wave-style" value={settings.waveformStyle} onChange={(event) => setSettings({ ...settings, waveformStyle: event.target.value as WaveformStyle })}>
                {(Object.entries(WAVEFORM_STYLES) as Array<[WaveformStyle, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="control-row">
              <div><label htmlFor="wave-density">Density</label><p>Control the waveform detail or number of particles</p></div>
              <select id="wave-density" value={settings.waveformDensity} onChange={(event) => setSettings({ ...settings, waveformDensity: event.target.value as WaveformDensity })}>
                {(Object.entries(WAVEFORM_DENSITIES) as Array<[WaveformDensity, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
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
            <div className="control-row progress-row">
              <div><label htmlFor="progress">Playback progress</label><p>Highlight the played section</p></div>
              <button id="progress" role="switch" aria-checked={settings.showProgress} className={`switch ${settings.showProgress ? "on" : ""}`} onClick={() => setSettings({ ...settings, showProgress: !settings.showProgress })}><span /></button>
            </div>
          </section>
        </div>

        <section className="export-panel">
          <div className="export-copy"><span className="section-label">Export</span><h2>Ready to make it move?</h2><p>{VIDEO_FORMATS[videoFormat].label} · 1080p · with audio</p></div>
          <div className="export-options">
            <label className="export-field">
              <span>Video type</span>
              <select value={videoFormat} onChange={(event) => setVideoFormat(event.target.value as VideoFormat)}>
                {(Object.entries(VIDEO_FORMATS) as Array<[VideoFormat, (typeof VIDEO_FORMATS)[VideoFormat]]>).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
              </select>
            </label>
            <label className="export-field">
              <span>Video theme</span>
              <select value={settings.videoTheme} onChange={(event) => setSettings({ ...settings, videoTheme: event.target.value as VideoTheme })}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
          </div>
          <div className="export-actions">
            <button className="export-button" onClick={() => void createExport()} disabled={exporting}>{exporting ? "Rendering…" : exportUrl ? "Render again" : "Render video"}</button>
            {exportUrl && <a className="download-button" href={exportUrl} download={`${safeExportName(`${track.name.replace(/\.[^.]+$/, "")}-wavevo`)}.${videoFormat}`}>Download</a>}
          </div>
        </section>
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>
      <AppFooter />
    </main>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      className={`theme-toggle ${theme === "light" ? "light" : ""}`}
      onClick={onToggle}
      role="switch"
      aria-checked={theme === "light"}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      <span aria-hidden="true">☼</span><i /><span aria-hidden="true">☾</span>
    </button>
  );
}

function AppFooter() {
  return (
    <footer className="landing-footer">
      <span>Wavevo · Audio into motion</span>
      <span>© 2026 · Designed &amp; built by <a href="https://www.testx.sk" target="_blank" rel="noreferrer">testx</a></span>
    </footer>
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
