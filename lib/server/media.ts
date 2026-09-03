import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { PNG } from "pngjs";
import type { ExportSettings } from "@/lib/types";
import { runProcess } from "./process";

const PEAK_COUNT = 2400;
const SAMPLE_RATE = 8000;
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const WAVEFORM_INSET = 110;

type ProbeResult = {
  format?: { duration?: string; format_name?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string }>;
};

function binaryPath(value: string | null): string {
  if (!value) throw new Error("FFmpeg is not available on this platform.");
  return value;
}

export async function probeAudio(inputPath: string) {
  const raw = await runProcess(ffprobeStatic.path, ["-v", "error", "-show_streams", "-show_format", "-of", "json", inputPath], { captureStdout: true });
  const result = JSON.parse(raw.toString()) as ProbeResult;
  const audioStream = result.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(result.format?.duration);
  if (!audioStream || !Number.isFinite(duration) || duration <= 0) throw new Error("The uploaded file does not contain readable audio.");
  return { duration, codec: audioStream.codec_name || "unknown", format: result.format?.format_name || "unknown" };
}

export async function createPlaybackCopy(inputPath: string, outputPath: string) {
  await runProcess(binaryPath(ffmpegPath), [
    "-y", "-v", "error", "-i", inputPath, "-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", outputPath,
  ]);
}

export async function createPeaks(inputPath: string, duration: number) {
  const samplesPerPeak = Math.max(1, Math.ceil((duration * SAMPLE_RATE) / PEAK_COUNT));
  return new Promise<number[]>((resolve, reject) => {
    const process = spawn(binaryPath(ffmpegPath), [
      "-v", "error", "-i", inputPath, "-map", "0:a:0", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const peaks: number[] = [];
    const errors: Buffer[] = [];
    let sampleIndex = 0;
    let maximum = 0;
    let pendingByte: number | null = null;

    process.stdout.on("data", (chunk: Buffer) => {
      let buffer = chunk;
      if (pendingByte !== null) {
        buffer = Buffer.concat([Buffer.from([pendingByte]), chunk]);
        pendingByte = null;
      }
      if (buffer.length % 2) {
        pendingByte = buffer[buffer.length - 1];
        buffer = buffer.subarray(0, -1);
      }
      for (let offset = 0; offset < buffer.length; offset += 2) {
        maximum = Math.max(maximum, Math.abs(buffer.readInt16LE(offset)) / 32768);
        sampleIndex += 1;
        if (sampleIndex >= samplesPerPeak) {
          peaks.push(Math.min(1, maximum));
          sampleIndex = 0;
          maximum = 0;
        }
      }
    });
    process.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    process.on("error", reject);
    process.on("close", (code) => {
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString() || "Could not generate waveform."));
      if (sampleIndex) peaks.push(maximum);
      const globalMaximum = Math.max(...peaks, 0.00001);
      resolve(peaks.length ? peaks.map((peak) => peak / globalMaximum) : [0]);
    });
  });
}

function parseHex(color: string) {
  const value = color.replace("#", "");
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
}

export async function renderWaveformImage(peaksPath: string, outputPath: string, color: string) {
  const peaks = JSON.parse(await readFile(peaksPath, "utf8")) as number[];
  const width = VIDEO_WIDTH;
  const height = VIDEO_HEIGHT;
  const png = new PNG({ width, height, colorType: 6 });
  const [red, green, blue] = parseHex(color);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const horizontal = (x - width * 0.5) / (width * 0.44);
      const vertical = (y - height * 0.42) / (height * 0.52);
      const glow = Math.max(0, 1 - Math.sqrt(horizontal * horizontal + vertical * vertical));
      const offset = (width * y + x) * 4;
      png.data[offset] = Math.round(9 + 15 * glow);
      png.data[offset + 1] = Math.round(11 + 3 * glow);
      png.data[offset + 2] = Math.round(14 + 2 * glow);
      png.data[offset + 3] = 255;
    }
  }
  const left = WAVEFORM_INSET;
  const usableWidth = width - left * 2;
  const center = Math.floor(height * 0.49);
  const maxHeight = 590;
  const bars = Math.min(peaks.length, Math.floor(usableWidth / 6));
  for (let bar = 0; bar < bars; bar += 1) {
    const sourceStart = Math.floor((bar / bars) * peaks.length);
    const sourceEnd = Math.max(sourceStart + 1, Math.floor(((bar + 1) / bars) * peaks.length));
    let peak = 0;
    for (let source = sourceStart; source < sourceEnd; source += 1) peak = Math.max(peak, peaks[source] || 0);
    const x0 = Math.floor(left + (bar / bars) * usableWidth);
    const x1 = Math.max(x0 + 2, Math.floor(left + ((bar + 0.54) / bars) * usableWidth));
    const barHeight = Math.max(5, Math.round(peak * maxHeight));
    const y0 = center - Math.floor(barHeight / 2);
    const y1 = center + Math.ceil(barHeight / 2);
    const radius = Math.max(1, (x1 - x0) / 2);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const capCenterY = y < y0 + radius ? y0 + radius : y > y1 - radius ? y1 - radius : y;
        const capCenterX = (x0 + x1) / 2;
        if ((x - capCenterX) ** 2 + (y - capCenterY) ** 2 > radius ** 2) continue;
        const offset = (width * y + x) * 4;
        png.data[offset] = red; png.data[offset + 1] = green; png.data[offset + 2] = blue; png.data[offset + 3] = 255;
      }
    }
  }
  await writeFile(outputPath, PNG.sync.write(png));
}

function countdownFilters(seconds: number, color: string) {
  if (!seconds) return "";
  const filters = [`drawbox=x=0:y=0:w=iw:h=ih:color=0x090b0e@1:t=fill:enable='lt(t,${seconds})'`];
  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    filters.push(`drawtext=text='${seconds - elapsed}':fontcolor=0x${color.slice(1)}:fontsize=190:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${elapsed},${elapsed + 0.99})'`);
  }
  return `,${filters.join(",")}`;
}

export async function createVideo(inputAudio: string, imagePath: string, playedImagePath: string, outputPath: string, duration: number, settings: ExportSettings) {
  const totalDuration = duration + settings.countdown;
  const waveformWidth = VIDEO_WIDTH - WAVEFORM_INSET * 2;
  const progress = `max(0,min(1,(T-${settings.countdown})/${duration}))`;
  const playheadProgress = `max(0,min(1,(t-${settings.countdown})/${duration}))`;
  // Blend expressions run on YUV planes with different pixel widths. Expressing
  // the boundary as a fraction of each plane's W keeps luma and chroma aligned.
  const progressBoundary = `W*(${WAVEFORM_INSET}/${VIDEO_WIDTH}+${waveformWidth}/${VIDEO_WIDTH}*${progress})`;
  const playheadX = `${WAVEFORM_INSET}+${waveformWidth}*${playheadProgress}-w/2`;
  const videoFilter = settings.showProgress
    ? `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT},format=yuv420p,setpts=PTS-STARTPTS[base];[1:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT},format=yuv420p,setpts=PTS-STARTPTS[played];[base][played]blend=all_expr='if(lte(X,${progressBoundary}),B,A)'[mixed];color=c=0xf4f1e9:s=3x650:d=${totalDuration},format=yuv420p[line];[mixed][line]overlay=x='${playheadX}':y=(H-h)/2:enable='between(t,${settings.countdown},${totalDuration})'${countdownFilters(settings.countdown, settings.color)}[v]`
    : `[0:v]scale=1920:1080,format=yuv420p${countdownFilters(settings.countdown, settings.color)}[v]`;
  const audioFilter = settings.countdown
    ? `[2:a]adelay=${settings.countdown * 1000}:all=1[a]`
    : `[2:a]anull[a]`;
  await runProcess(binaryPath(ffmpegPath), [
    "-y", "-v", "error",
    "-loop", "1", "-framerate", "30", "-i", imagePath,
    "-loop", "1", "-framerate", "30", "-i", playedImagePath,
    "-i", inputAudio,
    "-filter_complex", `${videoFilter};${audioFilter}`,
    "-map", "[v]", "-map", "[a]", "-t", totalDuration.toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath,
  ]);
}
