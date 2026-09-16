import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { estimateRenderRemainingMs } from "../lib/server/render-estimate";
import { formatRenderDuration, renderTimeLabel } from "../lib/render-time";
import type { RenderJob } from "../lib/render-job";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RenderJobStore } from "../lib/server/render-jobs";
import { exportSchema } from "../lib/server/export-settings";

test("durable queue preserves snapshots, serializes workers, and recovers interruptions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wavevo-jobs-"));
  const filename = path.join(directory, "jobs.sqlite");
  let first = new RenderJobStore(filename);
  const second = new RenderJobStore(filename);
  try {
    const settings = exportSchema.parse({ sessionName: "Original session", tracks: [{ uploadId: "2b6c095f-42d0-4bad-868a-cfdfd4eebbbb", name: "Bass", volume: 1, pan: 0, start: 0, muted: false, solo: false }], masterVolume: 0.8, showProgress: true, countdown: 0, waveformStyle: "wave", waveformDensity: "high", videoTheme: "dark", format: "mp4" });
    const job = first.enqueue(settings, 3);
    assert.equal(job.startedAt, null);
    assert.equal(job.estimatedFinishAt, null);
    settings.sessionName = "Later edits";
    settings.tracks[0].volume = 0;
    const next = first.enqueue(settings, 3);
    first.close();
    first = new RenderJobStore(filename);
    assert.equal(first.list().length, 2, "history survives reopening the database");
    const startedAt = Date.now();
    const claimed = first.claim("worker-a", startedAt)!;
    assert.equal(second.get(job.id)?.startedAt, startedAt);
    assert.equal(claimed.id, job.id, "oldest render is first");
    assert.equal(claimed.settings.sessionName, "Original session");
    assert.equal(claimed.settings.tracks[0].volume, 1, "editing a session cannot mutate its queued snapshot");
    assert.equal(second.claim("worker-b"), undefined, "a second process cannot render concurrently");
    first.progress(job.id, "worker-a", 45, "Rendering frames", startedAt + 10000);
    assert.equal(second.get(job.id)?.estimatedFinishAt, startedAt + 10000, "estimate survives separate database connections");
    second.progress(job.id, "worker-b", 60, "Rendering frames", startedAt + 99999);
    assert.equal(second.get(job.id)?.estimatedFinishAt, startedAt + 10000, "only the owning worker may change timing");
    first.progress(job.id, "worker-a", 20, "Rendering frames");
    assert.equal(second.get(job.id)?.progress, 45, "progress cannot move backwards");
    second.complete(job.id, "worker-b", 123);
    assert.equal(first.get(job.id)?.status, "running", "only the owning worker can complete a job");
    first.complete(job.id, "worker-a", 1234);
    assert.equal(second.get(job.id)?.progress, 100);
    const finished = second.get(job.id)!;
    assert.equal(finished.startedAt, startedAt);
    assert.ok(finished.finishedAt! >= startedAt);
    assert.equal(finished.estimatedFinishAt, null);
    assert.equal(second.get(job.id)?.downloadUrl, `/api/exports/${job.id}?format=mp4`);
    assert.equal(second.claim("worker-b", Date.now() - 120_000)?.id, next.id);
    assert.equal(first.claim("worker-c"), undefined);
    assert.equal(second.get(next.id)?.status, "failed", "dead worker leaves a visible, retryable failure");
    assert.equal(second.heartbeat(next.id, "worker-b"), false);
    second.complete(next.id, "worker-b", 99);
    assert.equal(second.get(next.id)?.status, "failed", "expired workers cannot publish completion");
    const retry = first.retry(next.id)!;
    assert.equal(retry.status, "queued");
    assert.equal(retry.startedAt, null, "retries have their own render time");
    assert.equal(retry.estimatedFinishAt, null);
    assert.notEqual(retry.id, next.id);
    assert.equal(second.claim("worker-c")?.settings.sessionName, "Later edits");
    first.fail(retry.id, "worker-c", "Example failure");
    assert.equal(second.get(retry.id)?.error, "Example failure");
    assert.equal(first.retry(job.id), undefined, "completed videos cannot accidentally be retried");
    assert.ok(!("payload" in first.get(job.id)!), "public history excludes internal snapshots");
    const legacy = { id: "06bc517b-81a3-44f9-a0eb-5f196a39b0bd", sessionName: "Previous video", duration: 2, createdAt: 1, finishedAt: 1, format: "mov" as const, resolution: null, quality: null, bytes: 500 };
    first.importCompleted(legacy); second.importCompleted(legacy);
    assert.equal(first.list().filter(item => item.sessionName === legacy.sessionName).length, 1, "legacy import is idempotent");
  } finally { first.close(); second.close(); await rm(directory, { recursive: true, force: true }); }
});

test("render estimates need a measured sample and adapt to frame throughput", () => {
  assert.equal(estimateRenderRemainingMs(0, 300, 0), null);
  assert.equal(estimateRenderRemainingMs(10, 300, 3000), null);
  assert.equal(estimateRenderRemainingMs(30, 300, 1000), null);
  assert.equal(estimateRenderRemainingMs(30, 300, 3000), 28000);
  assert.ok(estimateRenderRemainingMs(60, 300, 9000)! > estimateRenderRemainingMs(60, 300, 6000)!, "slower rendering extends the estimate");
  assert.equal(estimateRenderRemainingMs(300, 300, 30000), null, "encoding completion is a separate stage");
  assert.equal(estimateRenderRemainingMs(10, 300, Infinity), null);
});

test("render timing excludes queue wait and handles old exports and uncertain estimates", () => {
  const job = { status: "running", stage: "Rendering frames", createdAt: 0, startedAt: 60000, finishedAt: null, estimatedFinishAt: 126000 } as RenderJob;
  assert.equal(renderTimeLabel(job, 90000), "Elapsed 30s · About 40s left");
  assert.equal(renderTimeLabel({ ...job, status: "completed", finishedAt: 135000 }), "Rendered in 1m 15s");
  assert.equal(renderTimeLabel({ ...job, status: "failed", finishedAt: 135000 }), "Stopped after 1m 15s");
  assert.equal(renderTimeLabel({ ...job, status: "completed", startedAt: null }), "Render time not recorded");
  assert.match(renderTimeLabel({ ...job, status: "queued", startedAt: null }), /when rendering starts/);
  assert.match(renderTimeLabel({ ...job, estimatedFinishAt: null }, 90000), /Estimating time/);
  assert.match(renderTimeLabel(job, 130000), /Updating estimate/);
  assert.match(renderTimeLabel({ ...job, stage: "Finalizing video" }, 130000), /Finishing up/);
  assert.equal(formatRenderDuration(3725000), "1h 2m 5s");
});

test("existing render libraries migrate without losing videos or inventing timing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wavevo-timing-migration-"));
  const filename = path.join(directory, "jobs.sqlite");
  const legacy = new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE render_jobs (
    id TEXT PRIMARY KEY, outputId TEXT NOT NULL, sessionName TEXT NOT NULL,
    status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL,
    createdAt INTEGER NOT NULL, finishedAt INTEGER, duration REAL NOT NULL,
    format TEXT NOT NULL, resolution TEXT, quality TEXT, bytes INTEGER, error TEXT,
    payload TEXT, owner TEXT, heartbeat INTEGER, UNIQUE(outputId, format)
  );
  INSERT INTO render_jobs (id, outputId, sessionName, status, progress, stage, createdAt, finishedAt, duration, format)
    VALUES ('existing', 'existing', 'Saved session', 'completed', 100, 'Ready to download', 1000, 90000, 5, 'mp4');`);
  legacy.close();
  const migrated = new RenderJobStore(filename);
  const reopened = new RenderJobStore(filename);
  try {
    const job = reopened.get("existing")!;
    assert.equal(job.sessionName, "Saved session");
    assert.equal(job.finishedAt, 90000);
    assert.equal(job.startedAt, null);
    assert.equal(job.estimatedFinishAt, null);
    assert.equal(job.downloadUrl, "/api/exports/existing?format=mp4");
    assert.equal(migrated.list().length, 1);
  } finally { migrated.close(); reopened.close(); await rm(directory, { recursive: true, force: true }); }
});
