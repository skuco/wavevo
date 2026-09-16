import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_ROOT } from "./paths";
import { VIDEO_RESOLUTIONS } from "../video-resolution";
import { VIDEO_QUALITIES } from "../video-quality";
import type { RenderJobStore } from "./render-jobs";

// Bring videos from the previous synchronous exporter into the library once at startup.
export async function importExistingExports(store: RenderJobStore) {
  const directories = await readdir(UPLOAD_ROOT, { withFileTypes: true }).catch(() => []);
  for (const entry of directories) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    for (const format of ["mp4", "mov"] as const) {
      try {
        const directory = path.join(UPLOAD_ROOT, entry.name);
        const file = await stat(path.join(directory, `export.${format}`));
        if (!file.size) continue;
        const metadata = JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8"));
        store.importCompleted({ id: entry.name, sessionName: metadata.sessionName || metadata.name || "Untitled session", format,
          createdAt: file.mtimeMs, finishedAt: file.mtimeMs, bytes: file.size, duration: metadata.duration || 0,
          resolution: Object.hasOwn(VIDEO_RESOLUTIONS, metadata.resolution) ? metadata.resolution : null,
          quality: Object.hasOwn(VIDEO_QUALITIES, metadata.quality) ? metadata.quality : null });
      } catch { /* Source uploads and incomplete exports are not videos. */ }
    }
  }
}
