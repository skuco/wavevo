import { access, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";
import ffmpeg from "ffmpeg-static";
import type { ExportSettings, VideoFormat } from "@/lib/types";
import { VIDEO_RESOLUTIONS, type VideoResolution } from "@/lib/video-resolution";
import { VIDEO_QUALITIES, type VideoQuality } from "@/lib/video-quality";

async function browserPath() {
  const candidates = [
    process.env.WAVEVO_CHROME_PATH,
    chromium.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { await access(candidate); return candidate; } catch { /* Try the next installed browser. */ }
  }
  throw new Error("Studio video export needs Chrome or Chromium. Install it on the server or set WAVEVO_CHROME_PATH.");
}

function renderOrigin() {
  const url = new URL(process.env.WAVEVO_RENDER_ORIGIN || `http://127.0.0.1:${process.env.PORT || "3000"}`);
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("WAVEVO_RENDER_ORIGIN must point to the local Wavevo server.");
  }
  return url.origin;
}

// Render the actual Studio component at each video timestamp. This keeps its
// canvas waveforms, CSS, icons, clock, playhead, and meters identical to the app.
export async function createStudioVideo(id: string, audioPath: string, outputPath: string, duration: number, settings: ExportSettings, format: VideoFormat, resolution: VideoResolution = "1080p", quality: VideoQuality = "high", onProgress?: (frames: number, total: number) => void, signal?: AbortSignal) {
  if (!ffmpeg) throw new Error("FFmpeg is unavailable.");
  signal?.throwIfAborted();
  const origin = renderOrigin();
  const browser = await chromium.launch({ executablePath: await browserPath(), headless: true, chromiumSandbox: true });
  const abort = () => { void browser.close().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    // Keep the same composition at both resolutions. At 2× pixel density the
    // browser rasterizes text, icons, and DPR-aware waveform canvases in native 4K.
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: VIDEO_RESOLUTIONS[resolution].scale, reducedMotion: "reduce" });
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const response = await page.goto(`${origin}/studio-render/${id}`, { waitUntil: "networkidle", timeout: 60000 });
    if (!response?.ok()) throw new Error("Could not open the studio video view.");
    await page.waitForFunction(() => document.documentElement.dataset.studioRender === "ready" && [...document.querySelectorAll<HTMLCanvasElement>(".track-waveform")].every(canvas => canvas.dataset.rendered === "true"));
    await page.evaluate(async () => {
      await document.fonts.ready;
      const studio = document.querySelector<HTMLElement>(".studio-render")!;
      const height = studio.getBoundingClientRect().height;
      const scale = Math.min(1, 1080 / height);
      Object.assign(studio.style, { position: "absolute", left: `${(1920 - 1920 * scale) / 2}px`, top: `${(1080 - height * scale) / 2}px`, transform: `scale(${scale})`, transformOrigin: "top left" });
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    });

    const totalDuration = duration + settings.countdown;
    const profile = VIDEO_QUALITIES[quality];
    const encoder = spawn(ffmpeg, [
      "-y", "-v", "error", "-f", "image2pipe", "-framerate", "30", "-i", "pipe:0", "-i", audioPath,
      "-map", "0:v", "-map", "1:a", "-af", settings.countdown ? `adelay=${settings.countdown * 1000}:all=1` : "anull",
      "-c:v", profile.encoder, "-preset", profile.preset, "-crf", profile.crf, "-pix_fmt", profile.pixelFormat,
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", totalDuration.toFixed(3), "-f", format, outputPath,
    ], { stdio: ["pipe", "ignore", "pipe"], signal });
    let error = "";
    encoder.stderr.on("data", chunk => { error = (error + chunk.toString()).slice(-8000); });
    encoder.stdin.on("error", () => { /* The write callback and completion promise report errors. */ });
    const finished = new Promise<void>((resolve, reject) => {
      encoder.on("error", reject);
      encoder.on("close", code => code === 0 ? resolve() : reject(new Error(error || "Studio video encoding failed.")));
    });
    // Observe early process failures while frames are still being rendered.
    void finished.catch(() => {});
    try {
      for (let frame = 0; frame < Math.ceil(totalDuration * 30); frame++) {
        signal?.throwIfAborted();
        if (encoder.exitCode !== null) throw new Error(error || "Video encoder stopped unexpectedly.");
        const time = frame / 30 - settings.countdown;
        await page.evaluate(async time => {
          window.dispatchEvent(new CustomEvent("wavevo:render-frame", { detail: time }));
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        }, time);
        const png = await page.screenshot({ type: "png", scale: "device", animations: "disabled", caret: "hide", timeout: 30000 });
        if (frame === 0) await writeFile(path.join(path.dirname(outputPath), "studio-frame.png"), png);
        await new Promise<void>((resolve, reject) => encoder.stdin.write(png, caught => caught ? reject(caught) : resolve()));
        onProgress?.(frame + 1, Math.ceil(totalDuration * 30));
      }
      encoder.stdin.end();
      await finished;
    } catch (caught) {
      encoder.kill("SIGKILL");
      await finished.catch(() => {});
      throw caught;
    }
  } finally { signal?.removeEventListener("abort", abort); await browser.close(); }
}
