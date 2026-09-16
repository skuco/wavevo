import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("../", import.meta.url));
const dryRun = process.argv.includes("--dry-run");
const candidates = new Map();

async function details(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function include(filename) {
  const file = await details(filename);
  if (file?.isFile()) candidates.set(filename, file.size);
}

for (const filename of [".DS_Store", "tsconfig.tsbuildinfo"]) await include(path.join(root, filename));
const artifacts = path.join(root, "data/test-artifacts");
if ((await details(artifacts))?.isDirectory()) {
  for (const entry of await readdir(artifacts, { withFileTypes: true })) {
    if (entry.isFile() && /^studio-.*\.png$/.test(entry.name)) await include(path.join(artifacts, entry.name));
  }
}

const database = path.join(root, "data/renders.sqlite");
const db = (await details(database))?.isFile() ? new DatabaseSync(database, { readOnly: true }) : null;
try {
  const uploads = path.join(root, "data/uploads");
  const directories = (await details(uploads))?.isDirectory() ? await readdir(uploads, { withFileTypes: true }) : [];
  for (const entry of directories) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    const directory = path.join(uploads, entry.name);
    // Never touch a live render, or a directory without a finished video.
    const jobs = db?.prepare("SELECT status FROM render_jobs WHERE outputId = ?").all(entry.name) || [];
    if (jobs.some(job => job.status !== "completed") || await details(path.join(directory, "studio.json"))) continue;
    const video = await details(path.join(directory, "export.mp4")) || await details(path.join(directory, "export.mov"));
    if (!video?.isFile() || !video.size) continue;
    for (const filename of ["mix.wav", "waveform.png", "waveform-played.png", "studio-frame.png"]) {
      await include(path.join(directory, filename));
    }
  }
} finally { db?.close(); }

let bytes = 0;
for (const [filename, size] of candidates) {
  if (!dryRun) await rm(filename, { force: true });
  bytes += size;
  console.log(`${dryRun ? "Would remove" : "Removed"} ${path.relative(root, filename)}`);
}
console.log(`${dryRun ? "Found" : "Cleaned"} ${candidates.size} generated files (${(bytes / 1024 ** 2).toFixed(1)} MB). Uploads, videos, and render history are preserved.`);
