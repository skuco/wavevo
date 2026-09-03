# Wavevo

Wavevo is a focused waveform-video studio. Upload a WAV, MP3, or FLAC file, preview and seek through its waveform, customize playback, and export a 1080p video with audio.

## PoC features

- Drag-and-drop or file-picker upload (WAV, MP3, FLAC; maximum 200 MB)
- Streamed server upload with `ffprobe` media validation
- Precomputed, normalized waveform peaks for large files
- Browser-compatible MP3 playback proxy
- Click-to-seek waveform, play/pause, ±10 second controls, and timeline
- Custom waveform color
- Rounded bars, dense bars, and classic wave visualization styles
- Optional playback/export progress indicator
- Optional 3, 5, or 10 second countdown
- 1920×1080, 30 fps MP4 or MOV with H.264/AAC

## Run locally

Requirements: Node.js 20 or newer. FFmpeg and ffprobe binaries are installed through the project dependencies.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For a production build:

```bash
npm run build
npm start
```

## How it works

Uploads are streamed into `data/uploads/<uuid>`. The server inspects the file, generates a playback proxy and a compact peak array, then returns those peaks to WaveSurfer.js. Video export creates a waveform frame and combines it with the selected countdown, progress overlay, and audio using FFmpeg.

Generated media under `data/` is intentionally ignored by Git.

## PoC limitations

- Files and exports live on the local filesystem and are not automatically expired yet.
- Export runs inside the web process and the request stays open until FFmpeg finishes. A production deployment should use an external job queue/worker and object storage.
- There are no accounts or saved projects.
- Export currently uses one fixed 16:9 visual style and resolution.
- The local server must be deployed to a long-running Node environment; short-lived serverless functions are not appropriate for 200 MB uploads or video rendering.

## Checks

```bash
npm run typecheck
npm run build
```
