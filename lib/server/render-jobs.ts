import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_ROOT } from "./paths";
import type { RenderJob } from "../render-job";
import type { RenderRequest } from "./export-settings";

type Row = Omit<RenderJob, "downloadUrl"> & { payload: string | null; outputId: string; owner: string | null; heartbeat: number | null };
const LEASE_MS = 60_000;

// Separate connections in Next and the worker share one durable, local queue.
export class RenderJobStore {
  private db: DatabaseSync;
  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS render_jobs (
        id TEXT PRIMARY KEY, outputId TEXT NOT NULL, sessionName TEXT NOT NULL,
        status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL,
        createdAt INTEGER NOT NULL, startedAt INTEGER, finishedAt INTEGER, estimatedFinishAt INTEGER, duration REAL NOT NULL,
        format TEXT NOT NULL, resolution TEXT, quality TEXT, bytes INTEGER, error TEXT,
        payload TEXT, owner TEXT, heartbeat INTEGER,
        UNIQUE(outputId, format)
      );
      CREATE INDEX IF NOT EXISTS render_jobs_queue ON render_jobs(status, createdAt);
    `);
    // Migrate existing libraries without inventing start times for older exports.
    // The transaction also serializes migration in the web and worker processes.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const columns = new Set(this.db.prepare("PRAGMA table_info(render_jobs)").all().map(column => column.name));
      if (!columns.has("startedAt")) this.db.exec("ALTER TABLE render_jobs ADD COLUMN startedAt INTEGER");
      if (!columns.has("estimatedFinishAt")) this.db.exec("ALTER TABLE render_jobs ADD COLUMN estimatedFinishAt INTEGER");
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
  private publicJob(row: Row): RenderJob {
    const { payload: _payload, owner: _owner, heartbeat: _heartbeat, outputId, ...job } = row;
    return { ...job, downloadUrl: row.status === "completed" ? `/api/exports/${outputId}?format=${row.format}` : null };
  }
  get(id: string) {
    const row = this.db.prepare("SELECT * FROM render_jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? this.publicJob(row) : undefined;
  }
  list() {
    return (this.db.prepare("SELECT * FROM render_jobs ORDER BY createdAt DESC, rowid DESC").all() as Row[]).map(row => this.publicJob(row));
  }
  enqueue(settings: RenderRequest, duration: number) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO render_jobs (id, outputId, sessionName, status, stage, createdAt, duration, format, resolution, quality, payload)
      VALUES (?, ?, ?, 'queued', 'Waiting in queue', ?, ?, ?, ?, ?, ?)`).run(
      id, id, settings.sessionName, Date.now(), duration, settings.format, settings.resolution, settings.quality, JSON.stringify(settings));
    return this.get(id)!;
  }
  retry(id: string) {
    const row = this.db.prepare("SELECT * FROM render_jobs WHERE id = ? AND status = 'failed'").get(id) as Row | undefined;
    return row?.payload ? this.enqueue(JSON.parse(row.payload), row.duration) : undefined;
  }
  claim(owner: string, now = Date.now()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`UPDATE render_jobs SET status = 'failed', stage = 'Interrupted', finishedAt = ?,
        error = 'The render worker stopped. Retry this export to start again.', owner = NULL, estimatedFinishAt = NULL
        WHERE status = 'running' AND heartbeat < ?`).run(now, now - LEASE_MS);
      // Keep memory use bounded, even if two workers are accidentally launched.
      const busy = this.db.prepare("SELECT id FROM render_jobs WHERE status = 'running' LIMIT 1").get();
      const row = busy ? undefined : this.db.prepare("SELECT * FROM render_jobs WHERE status = 'queued' ORDER BY createdAt, rowid LIMIT 1").get() as Row | undefined;
      if (row) this.db.prepare("UPDATE render_jobs SET status = 'running', stage = 'Preparing audio', owner = ?, heartbeat = ?, startedAt = ?, estimatedFinishAt = NULL WHERE id = ?").run(owner, now, now, row.id);
      this.db.exec("COMMIT");
      return row ? { id: row.id, settings: JSON.parse(row.payload!) as RenderRequest } : undefined;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  heartbeat(id: string, owner: string) {
    return this.db.prepare("UPDATE render_jobs SET heartbeat = ? WHERE id = ? AND owner = ? AND status = 'running'").run(Date.now(), id, owner).changes === 1;
  }
  progress(id: string, owner: string, progress: number, stage: string, estimatedFinishAt: number | null = null) {
    this.db.prepare("UPDATE render_jobs SET progress = MAX(progress, ?), stage = ?, estimatedFinishAt = ? WHERE id = ? AND owner = ? AND status = 'running'")
      .run(Math.min(99, progress), stage, estimatedFinishAt, id, owner);
  }
  complete(id: string, owner: string, bytes: number) {
    this.db.prepare("UPDATE render_jobs SET status = 'completed', stage = 'Ready to download', progress = 100, bytes = ?, finishedAt = ?, estimatedFinishAt = NULL, owner = NULL WHERE id = ? AND owner = ? AND status = 'running'")
      .run(bytes, Date.now(), id, owner);
  }
  fail(id: string, owner: string, error: string) {
    this.db.prepare("UPDATE render_jobs SET status = 'failed', stage = 'Render failed', error = ?, finishedAt = ?, estimatedFinishAt = NULL, owner = NULL WHERE id = ? AND owner = ? AND status = 'running'")
      .run(error, Date.now(), id, owner);
  }
  importCompleted(job: Omit<RenderJob, "status" | "progress" | "stage" | "error" | "downloadUrl" | "startedAt" | "estimatedFinishAt">) {
    this.db.prepare(`INSERT OR IGNORE INTO render_jobs
      (id, outputId, sessionName, status, progress, stage, createdAt, finishedAt, duration, format, resolution, quality, bytes)
      VALUES (?, ?, ?, 'completed', 100, 'Ready to download', ?, ?, ?, ?, ?, ?, ?)`).run(
      `${job.id}-${job.format}`, job.id, job.sessionName, job.createdAt, job.finishedAt, job.duration, job.format, job.resolution, job.quality, job.bytes);
  }
}

const globalStore = globalThis as typeof globalThis & { wavevoJobStore?: RenderJobStore };
export const jobStore = () => globalStore.wavevoJobStore ??= new RenderJobStore(path.join(DATA_ROOT, "renders.sqlite"));
