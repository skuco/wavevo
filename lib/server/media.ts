import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { runProcess } from "./process";

const PEAK_COUNT = 2400;
const SAMPLE_RATE = 8000;

type ProbeResult = {
  format?: { duration?: string; format_name?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; channels?: number }>;
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
  return { duration, channels: audioStream.channels || 1, codec: audioStream.codec_name || "unknown", format: result.format?.format_name || "unknown" };
}

export async function createPlaybackCopy(inputPath: string, outputPath: string) {
  await runProcess(binaryPath(ffmpegPath), [
    "-y", "-v", "error", "-i", inputPath, "-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", outputPath,
  ]);
}

export async function createPeaks(inputPath: string, duration: number, channel?: number) {
  const samplesPerPeak = Math.max(1, Math.ceil((duration * SAMPLE_RATE) / PEAK_COUNT));
  return new Promise<number[]>((resolve, reject) => {
    const process = spawn(binaryPath(ffmpegPath), [
      "-v", "error", "-i", inputPath, "-map", "0:a:0", ...(channel === undefined ? [] : ["-af", `pan=mono|c0=c${channel}`]), "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:1",
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
