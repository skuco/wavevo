import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { runProcess } from "./process";

type MixInput = { path: string; volume: number; pan: number; start: number; channels: number };

// Match Web Audio's equal-power StereoPannerNode for mono and stereo sources.
export function panFilter(pan: number, channels: number) {
  if (channels === 1) {
    const angle = (pan + 1) * Math.PI / 4;
    return `pan=stereo|c0=${Math.cos(angle).toFixed(8)}*c0|c1=${Math.sin(angle).toFixed(8)}*c0`;
  }
  const angle = (pan <= 0 ? pan + 1 : pan) * Math.PI / 2;
  return pan <= 0
    ? `pan=stereo|c0=c0+${Math.cos(angle).toFixed(8)}*c1|c1=${Math.sin(angle).toFixed(8)}*c1`
    : `pan=stereo|c0=${Math.cos(angle).toFixed(8)}*c0|c1=c1+${Math.sin(angle).toFixed(8)}*c0`;
}

export async function createAudioMix(inputs: MixInput[], outputPath: string, duration: number, masterVolume: number) {
  if (!ffmpegPath) throw new Error("FFmpeg is unavailable.");
  const filters = inputs.map((input, index) => `[${index}:a]${panFilter(input.pan, input.channels)},volume=${input.volume * masterVolume},adelay=${Math.round(input.start * 1000)}:all=1[a${index}]`);
  filters.push(`${inputs.map((_, index) => `[a${index}]`).join("")}amix=inputs=${inputs.length}:duration=longest:normalize=0,apad,atrim=duration=${duration}[mix]`);
  await runProcess(ffmpegPath, ["-y", "-v", "error", ...inputs.flatMap(input => ["-i", input.path]), "-filter_complex", filters.join(";"), "-map", "[mix]", "-ar", "44100", "-c:a", "pcm_s16le", outputPath]);
}

export async function createLevelEnvelope(input: MixInput) {
  if (!ffmpegPath) throw new Error("FFmpeg is unavailable.");
  const binary = ffmpegPath;
  return new Promise<number[]>((resolve, reject) => {
    const process = spawn(binary, ["-v", "error", "-i", input.path, "-af", `${panFilter(input.pan, input.channels)},volume=${input.volume}`, "-ar", "8000", "-ac", "2", "-f", "f32le", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    const levels: number[] = [];
    let remainder = Buffer.alloc(0);
    let frame = 0;
    let error = "";
    process.stdout.on("data", (chunk: Buffer) => {
      const data = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
      const end = data.length - data.length % 8;
      for (let offset = 0; offset < end; offset += 8, frame++) {
        const bucket = Math.floor(frame * 30 / 8000);
        const peak = Math.max(Math.abs(data.readFloatLE(offset)), Math.abs(data.readFloatLE(offset + 4)));
        levels[bucket] = Math.min(1, Math.max(levels[bucket] || 0, peak));
      }
      remainder = Buffer.from(data.subarray(end));
    });
    process.stderr.on("data", chunk => { error = (error + chunk.toString()).slice(-4000); });
    process.on("error", reject);
    process.on("close", code => code === 0 ? resolve(levels) : reject(new Error(error || "Could not prepare track meters.")));
  });
}
