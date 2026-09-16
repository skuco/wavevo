import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { jobStore } from "../lib/server/render-jobs";
import { importExistingExports } from "../lib/server/import-exports";
import { renderExport } from "../lib/server/render-export";
import { uploadDirectory } from "../lib/server/paths";

async function main() {
  const store = jobStore();
  const owner = randomUUID();
  let stopping = false;
  let active: AbortController | undefined;
  const stop = () => { stopping = true; active?.abort(new Error("The render worker stopped. Retry this export to start again.")); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await importExistingExports(store);
  console.log("Wavevo render worker ready. Waiting for exports.");
  while (!stopping) {
    const job = store.claim(owner);
    if (!job) { await delay(750); continue; }
    active = new AbortController();
    const controller = active;
    const heartbeat = setInterval(() => {
      try { if (!store.heartbeat(job.id, owner)) controller.abort(new Error("Render ownership was lost. Retry this export.")); }
      catch (error) { controller.abort(error); }
    }, 5000);
    try {
      // Wait for Next to start before launching a queued render after a restart.
      const origin = process.env.WAVEVO_RENDER_ORIGIN || `http://127.0.0.1:${process.env.PORT || "3000"}`;
      let ready = false;
      for (let attempt = 0; attempt < 60 && !ready; attempt++) {
        controller.signal.throwIfAborted();
        try { ready = (await fetch(`${origin}/api/render-jobs/${job.id}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]) })).ok; } catch { /* Server is starting. */ }
        if (!ready) await delay(1000, undefined, { signal: controller.signal });
      }
      if (!ready) throw new Error("The local Wavevo server is unavailable. Start the app and retry this export.");
      let previous = "";
      const bytes = await renderExport(job.id, job.settings, (value, stage) => {
        controller.signal.throwIfAborted();
        if (`${value}:${stage}` === previous) return;
        previous = `${value}:${stage}`;
        store.progress(job.id, owner, value, stage);
      }, controller.signal);
      store.complete(job.id, owner, bytes);
      console.log(`Completed render ${job.id}`);
    } catch (caught) {
      console.error(`Render ${job.id} failed:`, caught);
      const message = controller.signal.aborted ? String(controller.signal.reason?.message || "The render was interrupted. Please retry.")
        : caught instanceof Error && /WAVEVO_CHROME_PATH|WAVEVO_RENDER_ORIGIN|local Wavevo server/.test(caught.message) ? caught.message
        : "The video could not be rendered. Please retry, or check the server log if it happens again.";
      store.fail(job.id, owner, message);
    } finally {
      clearInterval(heartbeat);
      active = undefined;
      for (const filename of ["mix.wav", "studio.json", `export.partial.${job.settings.format}`]) {
        await rm(path.join(uploadDirectory(job.id), filename), { force: true }).catch(console.error);
      }
    }
  }
  store.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
