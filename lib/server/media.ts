import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { PNG } from "pngjs";
import type { ExportSettings, VideoFormat, VideoTheme, WaveformDensity, WaveformStyle } from "@/lib/types";
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

function shapeAmplitude(value: number) {
  return Math.pow(Math.max(0, Math.min(1, Math.abs(value))), 1.65);
}

export async function renderWaveformImage(peaksPath: string, outputPath: string, color: string, style: WaveformStyle, density: WaveformDensity, videoTheme: VideoTheme) {
  const peaks = JSON.parse(await readFile(peaksPath, "utf8")) as number[];
  const width = VIDEO_WIDTH;
  const height = VIDEO_HEIGHT;
  const png = new PNG({ width, height, colorType: 6 });
  const [red, green, blue] = parseHex(color);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (width * y + x) * 4;
      if (videoTheme === "light") {
        png.data[offset] = 244;
        png.data[offset + 1] = 241;
        png.data[offset + 2] = 233;
      } else {
        const horizontal = (x - width * 0.5) / (width * 0.44);
        const vertical = (y - height * 0.42) / (height * 0.52);
        const glow = Math.max(0, 1 - Math.sqrt(horizontal * horizontal + vertical * vertical));
        png.data[offset] = Math.round(9 + 15 * glow);
        png.data[offset + 1] = Math.round(11 + 3 * glow);
        png.data[offset + 2] = Math.round(14 + 2 * glow);
      }
      png.data[offset + 3] = 255;
    }
  }
  const left = WAVEFORM_INSET;
  const usableWidth = width - left * 2;
  const center = Math.floor(height * 0.49);
  const maxHeight = 340;
  const densitySlot = density === "low" ? 8 : density === "high" ? 2 : 4;
  const slotWidth = densitySlot;
  const fillRatio = density === "low" ? 0.5 : density === "high" ? 0.72 : 0.62;
  const bars = Math.min(peaks.length, Math.floor(usableWidth / slotWidth));

  if (style === "wave") {
    const requestedPoints = density === "low" ? 160 : density === "high" ? 720 : 360;
    const pointCount = Math.max(2, Math.min(requestedPoints, peaks.length, usableWidth));
    const amplitudes = Array.from({ length: pointCount }, (_, point) => {
      const sourceStart = Math.floor((point / pointCount) * peaks.length);
      const sourceEnd = Math.max(sourceStart + 1, Math.floor(((point + 1) / pointCount) * peaks.length));
      let peak = 0;
      for (let source = sourceStart; source < sourceEnd; source += 1) peak = Math.max(peak, Math.abs(peaks[source] || 0));
      return shapeAmplitude(peak);
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
    for (let x = left; x < left + usableWidth; x += 1) {
      const position = ((x - left) / Math.max(1, usableWidth - 1)) * (pointCount - 1);
      const point = Math.floor(position);
      const nextPoint = Math.min(pointCount - 1, point + 1);
      const amplitude = smoothed[point] + (smoothed[nextPoint] - smoothed[point]) * (position - point);
      const halfHeight = Math.max(2, amplitude * maxHeight / 2);
      const y0 = Math.floor(center - halfHeight);
      const y1 = Math.ceil(center + halfHeight);
      for (let y = y0; y <= y1; y += 1) {
        const offset = (width * y + x) * 4;
        png.data[offset] = red; png.data[offset + 1] = green; png.data[offset + 2] = blue; png.data[offset + 3] = 255;
      }
    }
    await writeFile(outputPath, PNG.sync.write(png));
    return;
  }

  if (style === "particles") {
    const verticalSpacing = density === "low" ? 12 : density === "high" ? 5 : 8;
    const particleRadius = density === "low" ? 2.4 : density === "high" ? 1.4 : 1.9;
    for (let column = 0; column < bars; column += 1) {
      const sourceStart = Math.floor((column / bars) * peaks.length);
      const sourceEnd = Math.max(sourceStart + 1, Math.floor(((column + 1) / bars) * peaks.length));
      let peak = 0;
      for (let source = sourceStart; source < sourceEnd; source += 1) peak = Math.max(peak, peaks[source] || 0);
      const particleX = Math.round(left + ((column + 0.5) / bars) * usableWidth);
      const amplitude = Math.max(verticalSpacing / 2, shapeAmplitude(peak) * maxHeight / 2);
      for (let particleY = center - amplitude; particleY <= center + amplitude; particleY += verticalSpacing) {
        for (let y = Math.floor(particleY - particleRadius); y <= Math.ceil(particleY + particleRadius); y += 1) {
          for (let x = Math.floor(particleX - particleRadius); x <= Math.ceil(particleX + particleRadius); x += 1) {
            if ((x - particleX) ** 2 + (y - particleY) ** 2 > particleRadius ** 2) continue;
            const offset = (width * y + x) * 4;
            png.data[offset] = red; png.data[offset + 1] = green; png.data[offset + 2] = blue; png.data[offset + 3] = 255;
          }
        }
      }
    }
    await writeFile(outputPath, PNG.sync.write(png));
    return;
  }

  for (let bar = 0; bar < bars; bar += 1) {
    const sourceStart = Math.floor((bar / bars) * peaks.length);
    const sourceEnd = Math.max(sourceStart + 1, Math.floor(((bar + 1) / bars) * peaks.length));
    let peak = 0;
    for (let source = sourceStart; source < sourceEnd; source += 1) peak = Math.max(peak, peaks[source] || 0);
    const x0 = Math.floor(left + (bar / bars) * usableWidth);
    const x1 = Math.max(x0 + 2, Math.floor(left + ((bar + fillRatio) / bars) * usableWidth));
    const barHeight = Math.max(3, Math.round(shapeAmplitude(peak) * maxHeight));
    const y0 = center - Math.floor(barHeight / 2);
    const y1 = center + Math.ceil(barHeight / 2);
    const radius = style === "rounded" ? Math.max(1, (x1 - x0) / 2) : 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (radius) {
          const capCenterY = y < y0 + radius ? y0 + radius : y > y1 - radius ? y1 - radius : y;
          const capCenterX = (x0 + x1) / 2;
          if ((x - capCenterX) ** 2 + (y - capCenterY) ** 2 > radius ** 2) continue;
        }
        const offset = (width * y + x) * 4;
        png.data[offset] = red; png.data[offset + 1] = green; png.data[offset + 2] = blue; png.data[offset + 3] = 255;
      }
    }
  }
  await writeFile(outputPath, PNG.sync.write(png));
}

function countdownFilters(seconds: number, color: string, videoTheme: VideoTheme) {
  if (!seconds) return "";
  const background = videoTheme === "light" ? "0xf4f1e9" : "0x090b0e";
  const filters = [`drawbox=x=0:y=0:w=iw:h=ih:color=${background}@1:t=fill:enable='lt(t,${seconds})'`];
  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    filters.push(`drawtext=text='${seconds - elapsed}':fontcolor=0x${color.slice(1)}:fontsize=190:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${elapsed},${elapsed + 0.99})'`);
  }
  return `,${filters.join(",")}`;
}

function formatTimelineTime(seconds: number) {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function timelineFilters(duration: number, videoTheme: VideoTheme) {
  const scale = duration <= 60
    ? { minor: 2, major: 10 }
    : duration <= 300
      ? { minor: 5, major: 30 }
      : duration <= 900
        ? { minor: 10, major: 60 }
        : { minor: 60, major: 300 };
  const waveformWidth = VIDEO_WIDTH - WAVEFORM_INSET * 2;
  const tickColor = videoTheme === "light" ? "0x66696f" : "0x777b83";
  const labelColor = videoTheme === "light" ? "0x50535a" : "0x8b8d8f";
  const filters = [`drawbox=x=${WAVEFORM_INSET}:y=884:w=${waveformWidth}:h=1:color=${tickColor}@0.45:t=fill`];
  for (let time = 0; time <= duration; time += scale.minor) {
    const major = Math.round(time) % scale.major === 0;
    const x = WAVEFORM_INSET + (time / duration) * waveformWidth;
    filters.push(`drawbox=x=${x.toFixed(2)}:y=884:w=1:h=${major ? 16 : 8}:color=${tickColor}@${major ? 0.85 : 0.35}:t=fill`);
    if (major) {
      const label = formatTimelineTime(time).replaceAll(":", "\\:");
      filters.push(`drawtext=text='${label}':fontcolor=${labelColor}:fontsize=22:x='max(${WAVEFORM_INSET},min(w-${WAVEFORM_INSET}-text_w,${x.toFixed(2)}-text_w/2))':y=910`);
    }
  }
  return `,${filters.join(",")}`;
}

export async function createVideo(inputAudio: string, imagePath: string, playedImagePath: string, outputPath: string, duration: number, settings: ExportSettings, format: VideoFormat) {
  const totalDuration = duration + settings.countdown;
  const waveformWidth = VIDEO_WIDTH - WAVEFORM_INSET * 2;
  const progress = `max(0,min(1,(T-${settings.countdown})/${duration}))`;
  const playheadProgress = `max(0,min(1,(t-${settings.countdown})/${duration}))`;
  // Blend expressions run on YUV planes with different pixel widths. Expressing
  // the boundary as a fraction of each plane's W keeps luma and chroma aligned.
  const progressBoundary = `W*(${WAVEFORM_INSET}/${VIDEO_WIDTH}+${waveformWidth}/${VIDEO_WIDTH}*${progress})`;
  const playheadX = `${WAVEFORM_INSET}+${waveformWidth}*${playheadProgress}-w/2`;
  const playheadColor = settings.videoTheme === "light" ? "0x17191d" : "0xf4f1e9";
  const videoFilter = settings.showProgress
    ? `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT},format=yuv420p,setpts=PTS-STARTPTS[base];[1:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT},format=yuv420p,setpts=PTS-STARTPTS[played];[base][played]blend=all_expr='if(lte(X,${progressBoundary}),B,A)'[mixed];color=c=${playheadColor}:s=3x700:d=${totalDuration},format=yuv420p[line];[mixed][line]overlay=x='${playheadX}':y=190:enable='between(t,${settings.countdown},${totalDuration})'${timelineFilters(duration, settings.videoTheme)}${countdownFilters(settings.countdown, settings.color, settings.videoTheme)}[v]`
    : `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT},format=yuv420p${timelineFilters(duration, settings.videoTheme)}${countdownFilters(settings.countdown, settings.color, settings.videoTheme)}[v]`;
  const audioFilter = settings.countdown
    ? `[2:a]adelay=${settings.countdown * 1000}:all=1[a]`
    : `[2:a]anull[a]`;
  const encodingArguments = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
  await runProcess(binaryPath(ffmpegPath), [
    "-y", "-v", "error",
    "-loop", "1", "-framerate", "30", "-i", imagePath,
    "-loop", "1", "-framerate", "30", "-i", playedImagePath,
    "-i", inputAudio,
    "-filter_complex", `${videoFilter};${audioFilter}`,
    "-map", "[v]", "-map", "[a]", "-t", totalDuration.toFixed(3),
    ...encodingArguments, outputPath,
  ]);
}
