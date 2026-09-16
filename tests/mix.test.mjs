import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { PNG } from "pngjs";

const exec = promisify(execFile);
const origin = "http://127.0.0.1:3000";

function fixture(channels, seconds, frequency) {
  const rate = 22050;
  const frames = rate * seconds;
  const data = Buffer.alloc(44 + frames * channels * 2);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(channels, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * channels * 2, 28);
  data.writeUInt16LE(channels * 2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(frames * channels * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.sin(2 * Math.PI * frequency * frame / rate) * 9000 * (channel ? 0.5 : 1);
      data.writeInt16LE(Math.round(sample), 44 + (frame * channels + channel) * 2);
    }
  }
  return new File([data], `test-${channels}ch.wav`, { type: "audio/wav" });
}

function rms(pcm, from, to, channel) {
  let energy = 0;
  let samples = 0;
  for (let frame = Math.floor(from * 8000); frame < Math.floor(to * 8000); frame++) {
    const value = pcm.readFloatLE((frame * 2 + channel) * 4);
    energy += value * value;
    samples++;
  }
  return Math.sqrt(energy / samples);
}

test("Full HD and 4K studio videos preserve the interface, animation, and synchronized audio", { timeout: 300000 }, async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "wavevo-mix-test-"));
  const created = [];
  const post = (endpoint, body) => fetch(`${origin}${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const uploads = [];
    for (const [channels, seconds, frequency] of [[2, 2, 220], [1, 1, 440]]) {
      const body = new FormData();
      body.append("audio", fixture(channels, seconds, frequency));
      const response = await fetch(`${origin}/api/uploads`, { method: "POST", body });
      const track = await response.json();
      assert.equal(response.status, 200, JSON.stringify(track));
      created.push(track.id);
      assert.equal(track.channelPeaks.length, channels);
      assert.ok(Math.abs(track.duration - seconds) < 0.05);
      uploads.push(track);
    }
    const settings = {
      tracks: uploads.map((track, index) => ({ uploadId: track.id, name: index ? "Rose drums.wav" : "Teal bass.wav", color: index ? "#ed88ad" : "#18c9a7", volume: index ? 0.5 : 0.6, pan: index ? 1 : -1, start: index ? 2 : 0, muted: false, solo: false })),
      masterVolume: 0.8, color: "#18c9a7", showProgress: true, countdown: 0,
      waveformStyle: "wave", waveformDensity: "high", videoTheme: "dark", format: "mp4",
    };

    const queue = async body => {
      const response = await post("/api/mix-exports", body);
      const result = await response.json();
      assert.equal(response.status, 202, JSON.stringify(result));
      assert.equal(result.job.status, "queued", "request returns before rendering begins");
      assert.equal(result.job.downloadUrl, null, "partial video cannot be downloaded");
      created.push(result.job.id);
      return result.job;
    };
    const render = async (body, duration, queued) => {
      let job = queued || await queue(body);
      const exportId = job.id;
      let progress = 0;
      const deadline = Date.now() + 240000;
      const seen = new Set();
      while (job.status !== "completed") {
        assert.notEqual(job.status, "failed", job.error || "Render failed");
        assert.ok(Date.now() < deadline, "render timed out");
        await delay(300);
        const response = await fetch(`${origin}/api/render-jobs/${exportId}`);
        assert.equal(response.status, 200);
        job = (await response.json()).job;
        assert.ok(job.progress >= progress, "progress must be monotonic");
        progress = job.progress;
        if (job.status === "running") seen.add(job.progress);
      }
      assert.equal(job.progress, 100);
      assert.ok(seen.size > 1, "worker reports actual progress while rendering");
      const history = await (await fetch(`${origin}/api/render-jobs`)).json();
      assert.equal(history.jobs.find(item => item.id === exportId)?.status, "completed");
      const result = job;
      const download = await fetch(`${origin}${result.downloadUrl}`);
      assert.equal(download.status, 200);
      assert.ok(download.headers.get("content-disposition").includes("attachment"));
      const file = path.join(temporary, `export.${body.format}`);
      await writeFile(file, Buffer.from(await download.arrayBuffer()));
      const { stdout } = await exec(ffprobe.path, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
      const info = JSON.parse(stdout);
      const video = info.streams.find(stream => stream.codec_type === "video");
      const scale = body.resolution === "4k" ? 2 : 1;
      assert.deepEqual([video.width, video.height, video.r_frame_rate], [1920 * scale, 1080 * scale, "30/1"]);
      assert.equal(video.pix_fmt, body.quality === "lossless" ? "gbrp" : "yuv420p");
      assert.ok(info.streams.some(stream => stream.codec_type === "audio"));
      assert.ok(Math.abs(Number(info.format.duration) - duration) < 0.1);
      const artifacts = path.join(process.cwd(), "data", "test-artifacts");
      await mkdir(artifacts, { recursive: true });
      const imageAt = async time => {
        const image = await exec(ffmpeg, ["-v", "error", "-ss", String(time), "-i", file, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], { encoding: "buffer", maxBuffer: 4 * 1024 * 1024 });
        await writeFile(path.join(artifacts, `studio-${body.resolution || "1080p"}-${body.quality || "high"}-${body.format}-${time}.png`), image.stdout);
        return PNG.sync.read(image.stdout);
      };
      if (body.quality === "lossless") {
        const original = PNG.sync.read(await readFile(path.join(process.cwd(), "data", "uploads", exportId, "studio-frame.png")));
        const decoded = await imageAt(0);
        assert.deepEqual([decoded.width, decoded.height], [original.width, original.height]);
        assert.ok(decoded.data.equals(original.data), "lossless master must preserve every pixel of the source browser frame, including colored text and edges");
      }
      const initial = await imageAt(0.5);
      const later = await imageAt(duration - 0.5);
      assert.deepEqual([initial.width, initial.height], [1920 * scale, 1080 * scale]);
      // Compare identical layout positions in both physical pixel resolutions.
      const pixel = (image, x, y) => {
        const offset = (y * scale * image.width + x * scale) * 4;
        return [...image.data.subarray(offset, offset + 3)];
      };
      const distance = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
      const background = body.videoTheme === "light" ? [232, 237, 240] : [28, 34, 40];
      const toolbar = body.videoTheme === "light" ? [247, 249, 250] : [37, 45, 52];
      assert.ok(distance(pixel(initial, 1100, 30), background) < 8, "video must contain the actual app header");
      assert.ok(distance(pixel(initial, 1100, 100), toolbar) < 8, "video must contain the transport toolbar");
      if (body.format === "mp4") {
        const colors = [[24, 201, 167], [237, 136, 173]];
        const counts = [0, 0];
        for (let y = 275; y < 660; y++) {
          for (let x = 304; x < 500; x++) {
            const value = pixel(initial, x, y);
            colors.forEach((color, index) => { if (distance(value, color) < 18) counts[index]++; });
          }
        }
        assert.ok(counts[0] > 1500 && counts[1] > 1000, `both independently colored lanes must survive export: ${counts}`);
        const playheadX = image => {
          let best = { x: 0, brightness: 0 };
          for (let x = 305; x < 490; x++) {
            let brightness = 0;
            for (let y = 700; y < 900; y++) brightness += Math.min(...pixel(image, x, y));
            if (brightness > best.brightness) best = { x, brightness };
          }
          return best.x;
        };
        assert.ok(playheadX(later) - playheadX(initial) > 90, "playhead must move along the shared timeline");
        const bassMeterPixels = image => {
          let count = 0;
          for (let y = 300; y < 450; y++) {
            for (let x = 282; x < 290; x++) {
              const [r, g, b] = pixel(image, x, y);
              if (r > 100 && b > r + 20 && r > g + 20) count++;
            }
          }
          return count;
        };
        assert.ok(bassMeterPixels(initial) > 10 && bassMeterPixels(later) < 5, "track meters must follow their own audio and return to zero when it ends");
      }
      let clockChanges = 0;
      for (let y = 96; y < 126; y++) {
        for (let x = 290; x < 515; x++) if (distance(pixel(initial, x, y), pixel(later, x, y)) > 30) clockChanges++;
      }
      assert.ok(clockChanges > 30, "the interface clock must advance during the video");
      const audio = await exec(ffmpeg, ["-v", "error", "-i", file, "-vn", "-ac", "2", "-ar", "8000", "-f", "f32le", "pipe:1"], { encoding: "buffer", maxBuffer: 1024 * 1024 });
      return audio.stdout;
    };

    // Queue two snapshots without waiting. HTTP stays available and one worker drains them in order.
    const queued = await queue(settings);
    const solo = structuredClone(settings);
    solo.tracks[1].solo = true;
    solo.format = "mov"; solo.countdown = 3; solo.videoTheme = "light"; solo.resolution = "4k"; solo.quality = "balanced";
    const queuedSolo = await queue(solo);
    assert.equal((await fetch(`${origin}/`)).status, 200, "the editor remains available during rendering");
    const initialHistory = await (await fetch(`${origin}/api/render-jobs`)).json();
    assert.ok(initialHistory.jobs.filter(job => job.status === "running").length <= 1);
    const mix = await render(settings, 3, queued);
    assert.ok(rms(mix, 0.2, 0.8, 0) > 0.1, "first track must be audible on the left");
    assert.ok(rms(mix, 0.2, 0.8, 1) < 0.005, "right channel must wait for delayed track");
    assert.ok(rms(mix, 2.2, 2.8, 0) < 0.005, "shorter track must end");
    assert.ok(rms(mix, 2.2, 2.8, 1) > 0.05, "mono track must start at two seconds on the right");
    // Expected mono RMS: 9000 / 32768 / sqrt(2), scaled by track and master gain.
    const expected = 9000 / 32768 / Math.sqrt(2) * 0.5 * 0.8;
    assert.ok(Math.abs(rms(mix, 2.2, 2.8, 1) - expected) < 0.015, "export must preserve track and master gain");

    const isolated = await render(solo, 6, queuedSolo);
    assert.ok(rms(isolated, 0.2, 4.8, 0) < 0.005, "solo must exclude the first track");
    assert.ok(rms(isolated, 0.2, 4.8, 1) < 0.005, "countdown and clip offset must both delay audio");
    assert.ok(rms(isolated, 5.2, 5.8, 1) > 0.05);

    const master = await render({ ...settings, resolution: "4k", quality: "lossless", format: "mov" }, 3);
    assert.ok(rms(master, 0.2, 0.8, 0) > 0.1, "lossless video must retain the session audio");

    solo.tracks[1].muted = true;
    const silent = await post("/api/mix-exports", solo);
    assert.equal(silent.status, 400, "muting the only solo track must reject a silent export");
    assert.match((await silent.json()).error, /unmute/i);
    const invalid = await post("/api/mix-exports", { ...settings, tracks: [{ ...settings.tracks[0], start: -1 }] });
    assert.equal(invalid.status, 400, "negative track offsets must be rejected");
    const invalidResolution = await post("/api/mix-exports", { ...settings, resolution: "8k" });
    assert.equal(invalidResolution.status, 400, "unsupported resolutions must be rejected");
    const invalidQuality = await post("/api/mix-exports", { ...settings, quality: "unknown" });
    assert.equal(invalidQuality.status, 400, "unsupported quality presets must be rejected");
  } finally {
    await rm(temporary, { recursive: true, force: true });
    // Only remove upload/export IDs created by this test run.
    const jobs = new DatabaseSync(path.join(process.cwd(), "data", "renders.sqlite"));
    for (const id of created) {
      assert.match(id, /^[0-9a-f-]{36}$/);
      jobs.prepare("DELETE FROM render_jobs WHERE id = ?").run(id);
      await rm(path.join(process.cwd(), "data", "uploads", id), { recursive: true, force: true });
    }
    jobs.close();
  }
});
