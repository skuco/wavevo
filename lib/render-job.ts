import type { VideoFormat } from "./types";
import type { VideoResolution } from "./video-resolution";
import type { VideoQuality } from "./video-quality";

export type RenderJob = {
  id: string;
  sessionName: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  stage: string;
  createdAt: number;
  finishedAt: number | null;
  duration: number;
  format: VideoFormat;
  resolution: VideoResolution | null;
  quality: VideoQuality | null;
  bytes: number | null;
  error: string | null;
  downloadUrl: string | null;
};

export const isActiveJob = (job: RenderJob) => job.status === "queued" || job.status === "running";
