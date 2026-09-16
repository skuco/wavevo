# Wavevo

Wavevo is a multitrack audio and video studio. Arrange WAV, MP3, and FLAC tracks on a shared timeline, balance your audio, and export a Full HD or 4K video of the full studio interface.

## PoC features

- Add multiple tracks through drag-and-drop or the file picker (WAV, MP3, FLAC; maximum 200 MB each, 32 tracks per session)
- Charcoal and light editor themes, individual track colors, and real mono/stereo waveforms
- Shared Web Audio playback clock, per-track volume and pan, mute/solo, live meters, and master volume
- Zoomable timeline, draggable track start times, optional snapping, compact lanes, and loop playback
- Original bass/drums demo session
- Streamed server upload with `ffprobe` media validation
- Precomputed, normalized waveform peaks for large files
- Browser-compatible MP3 playback proxy
- Click-to-seek waveforms, play/pause, stop, start/end controls, and keyboard shortcuts (Space, Home, Escape, and arrow keys)
- Custom track colors
- Rounded bars, square bars, particles, and classic wave visualization styles
- Low, medium, and high waveform density, including smooth-to-detailed classic waves
- Export progress indicator and optional 3, 5, or 10 second countdown
- Full HD (1920×1080) or 4K UHD (3840×2160), 30 fps MP4 or MOV with H.264/AAC
- Full-interface video export using the actual app layout, icons, controls, individual track colors/names, and separate mono/stereo waveforms
- Animated timeline playhead, clock, and per-track audio meters, with synchronized session audio
- Audio follows track start times, mute/solo, gain, pan, and master volume
- Video defaults to the current editor theme, with dark and light choices

## Run locally

Requirements: Node.js 20 or newer. FFmpeg and ffprobe binaries are installed through the project dependencies.

Interface video export also needs Google Chrome or Chromium on the server. Wavevo finds a standard local installation automatically. To use a custom installation, set `WAVEVO_CHROME_PATH` to the browser executable. Alternatively, install Chromium with `npx playwright-core install chromium`.

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

Uploads are streamed into `data/uploads/<uuid>`. The server inspects each file and generates a playback proxy plus compact waveform peaks for each channel. Canvas renders track lanes, while Web Audio schedules decoded audio against one shared clock.

Video export opens the same Studio component in a fresh headless browser, fits the whole interface into a 1920×1080 layout, and renders each frame at an exact 30 fps timestamp. Choose Full HD or 4K in the export dialog. Full HD uses 1× pixel density; 4K uses 2× density to draw text, icons, and waveform canvases directly at 3840×2160 while preserving the layout. Audio-derived meter values, the clock, and the playhead follow that timestamp. FFmpeg encodes the frames with the audible session audio. Every export gets its own output directory; the temporary render-page data is removed after rendering. No screen-sharing permission or recording of the user's desktop is needed.

The renderer connects to the local server on `PORT` (3000 by default). If your server uses a different local address, set `WAVEVO_RENDER_ORIGIN`, for example `http://127.0.0.1:3001`. Only loopback origins are accepted.

Generated media under `data/` is intentionally ignored by Git.

## PoC limitations

- Files and exports live on the local filesystem and are not automatically expired yet.
- Export runs inside the web process and the request stays open until FFmpeg finishes. A production deployment should use an external job queue/worker and object storage.
- There are no accounts or saved projects. Refreshing the page clears the current arrangement.
- Playback decodes tracks in browser memory; very large multitrack sessions need sufficient memory.
- Video uses a 16:9 frame at the selected Full HD or 4K resolution. Larger arrangements are scaled down to include the whole interface. 4K produces larger files and takes longer to render.
- Rendering happens frame by frame and can take longer than the audio duration.
- The local server must be deployed to a long-running Node environment; short-lived serverless functions are not appropriate for 200 MB uploads or video rendering.

## Checks

```bash
npm run typecheck
npm run build
```

With the development server running on `127.0.0.1:3000`, run `npm run test:integration` to verify real uploads and MP4/MOV downloads, the actual studio design, separate colored lanes, animated clock/playhead/meters, stereo audio, offsets, gain, pan, mute/solo, countdowns, and validation. The test removes its own audio/video fixtures and saves video-frame images under `data/test-artifacts/` for visual inspection.
