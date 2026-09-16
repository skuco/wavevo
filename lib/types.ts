export type UploadedTrack = {
  id: string;
  name: string;
  duration: number;
  peaks: number[];
  channelPeaks?: number[][];
  audioUrl: string;
};

export type SessionTrack = UploadedTrack & {
  color: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  start: number;
};

export type WaveformStyle = "rounded" | "square" | "particles" | "wave";
export type WaveformDensity = "low" | "medium" | "high";
export type VideoTheme = "dark" | "light";

export type ExportSettings = {
  showProgress: boolean;
  countdown: 0 | 3 | 5 | 10;
  waveformStyle: WaveformStyle;
  waveformDensity: WaveformDensity;
  videoTheme: VideoTheme;
};

export type VideoFormat = "mp4" | "mov";

export type StudioRenderSession = {
  sessionName: string;
  tracks: Array<SessionTrack & { meterPeaks: number[] }>;
  settings: ExportSettings;
  masterVolume: number;
  selectedId: string;
  compact: boolean;
  fillScreen: boolean;
  loop: boolean;
  snap: boolean;
  snapInterval: number;
};
