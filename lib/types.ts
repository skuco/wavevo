export type UploadedTrack = {
  id: string;
  name: string;
  duration: number;
  peaks: number[];
  audioUrl: string;
};

export type ExportSettings = {
  color: string;
  showProgress: boolean;
  countdown: 0 | 3 | 5 | 10;
};
