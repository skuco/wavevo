export type UploadedTrack = {
  id: string;
  name: string;
  duration: number;
  peaks: number[];
  audioUrl: string;
};

export type WaveformStyle = "rounded" | "dense" | "wave";

export type ExportSettings = {
  color: string;
  showProgress: boolean;
  countdown: 0 | 3 | 5 | 10;
  waveformStyle: WaveformStyle;
};

export type VideoFormat = "mp4" | "mov";
