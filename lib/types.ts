export type UploadedTrack = {
  id: string;
  name: string;
  duration: number;
  peaks: number[];
  audioUrl: string;
};

export type WaveformStyle = "rounded" | "square" | "particles" | "wave";
export type WaveformDensity = "low" | "medium" | "high";
export type VideoTheme = "dark" | "light";

export type ExportSettings = {
  color: string;
  showProgress: boolean;
  countdown: 0 | 3 | 5 | 10;
  waveformStyle: WaveformStyle;
  waveformDensity: WaveformDensity;
  videoTheme: VideoTheme;
};

export type VideoFormat = "mp4" | "mov";
