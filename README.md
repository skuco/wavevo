# Wavevo

Wavevo is a multitrack audio and video studio. Arrange WAV, MP3, and FLAC tracks on a shared timeline, balance your audio, and export a Full HD or 4K video of the full studio interface.

## Features

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
- Moving video playhead and optional 3, 5, or 10 second countdown
- Full HD (1920×1080) or 4K UHD (3840×2160), 30 fps MP4 or MOV with H.264/AAC
- High quality (default), lossless RGB video masters, or balanced exports for smaller files
- Full-interface video export using the actual app layout, icons, controls, individual track colors/names, and separate mono/stereo waveforms
- Animated timeline playhead, clock, and per-track audio meters, with synchronized session audio
- Audio follows track start times, mute/solo, gain, pan, and master volume
- Video defaults to the current editor theme, with dark and light choices
- Background render queue with actual frame progress, completion notices, and a saved video library
- Immutable export snapshots: continue editing or close the tab while a video renders
- Retry failed exports; existing videos are imported into the library

## Run locally

Requirements: Node.js 24 or newer (uses the built-in SQLite module). FFmpeg and ffprobe binaries are installed through the project dependencies.

Interface video export also needs Google Chrome or Chromium on the server. Wavevo finds a standard local installation automatically. To use a custom installation, set `WAVEVO_CHROME_PATH` to the browser executable. Alternatively, install Chromium with `npx playwright-core install chromium`.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Both `npm run dev` and `npm start` launch the web app and a separate render worker. No Redis, cloud service, or additional database installation is needed.

For a production build:

```bash
npm run build
npm start
```

## How it works

Uploads are streamed into `data/uploads/<uuid>`. The server inspects each file and generates a playback proxy plus compact waveform peaks for each channel. Canvas renders track lanes, while Web Audio schedules decoded audio against one shared clock.

Video export opens the same Studio component in a fresh headless browser, fits the whole interface into a 1920×1080 layout, and renders each frame at an exact 30 fps timestamp. Choose Full HD or 4K in the export dialog. Full HD uses 1× pixel density; 4K uses 2× density to draw text, icons, and waveform canvases directly at 3840×2160 while preserving the layout. Audio-derived meter values, the clock, and the playhead follow that timestamp. FFmpeg encodes the frames with the audible session audio. Every export gets its own output directory; the temporary render-page data is removed after rendering. No screen-sharing permission or recording of the user's desktop is needed.

The renderer connects to the local server on `PORT` (3000 by default). If your server uses a different local address, set `WAVEVO_RENDER_ORIGIN`, for example `http://127.0.0.1:3001`. Only loopback origins are accepted.

### Background rendering

Choose **Export video → Render in background**. The API saves a snapshot of your arrangement and settings and immediately returns a queued job. The dialog closes, so playback and editing remain available. The strip under the header shows its stage, percentage, elapsed time, and estimated time remaining; **Videos** opens the queue and completed downloads. Progress uses audio preparation stages and actual rendered frame counts, reaching 100% only after encoding and saving finish.

Time remaining is estimated from actual frame throughput after a short initial sample and updates as rendering proceeds. Preparation shows “Estimating time”; final encoding shows “Finishing up”. Completed videos show the time from worker start to completion, excluding the queue wait. Timing is saved for new renders; older exports show “Render time not recorded”.

Jobs and history are stored in `data/renders.sqlite`; videos remain in `data/uploads/<uuid>`. The worker imports videos created by the previous exporter when it starts. Rendering is sequential to limit CPU and memory pressure. Changes to the editor cannot change a submitted export. The browser may close, but the server and worker must stay running and the computer must remain awake.

Queued jobs survive restarts. An interrupted in-progress render becomes a failed entry after its 60-second worker lease expires, with **Retry render** available. Retrying creates a new job from the saved settings. Partial video files never appear as completed downloads. A successful render removes its temporary mix and render-page data.

For separate process supervision, use `npm run dev:web` (or `npm run start:web`) and `npm run worker` in separate terminals. Set the same `PORT` in both environments, or set `WAVEVO_RENDER_ORIGIN` for the worker. The combined launcher forwards `--port` / `-p` to both processes. Restart the worker after changing server rendering code.

Background jobs free the editor and avoid long HTTP requests; they do not speed up frame generation itself. Hardware encoding and a more efficient frame compositor remain separate optimizations.

### Export quality

Resolution controls the pixel dimensions; **Video quality** controls compression:

- **High quality** (default): H.264, CRF 10, medium preset, YUV 4:2:0. Sharp detail with broad player support.
- **Lossless master**: H.264 RGB, CRF 0. Preserves every rendered video pixel without color subsampling. Files are larger and require a player or editor that supports H.264 RGB / High 4:4:4 Predictive; many hardware decoders and browser players do not support this profile. Audio still uses AAC.
- **Balanced**: H.264, CRF 18, veryfast preset, YUV 4:2:0 for smaller files and faster encoding.

Use 4K with High quality for everyday playback, or Lossless master to retain the exact rendered image. Compression settings cannot enlarge tiny text in a large arrangement: fitting many tracks into one frame scales down the interface. A player that scales the video to a smaller window or a service that re-encodes an upload can also affect perceived sharpness.

Generated media under `data/` is intentionally ignored by Git.

## Current limitations

- Files and exports live on the local filesystem and are not automatically expired yet.
- The queue and library are shared by this local installation. There are no user accounts or per-user access controls; multi-user hosting needs authentication, storage isolation, and object storage.
- There are no accounts or saved projects. Refreshing the page clears the current arrangement.
- Playback decodes tracks in browser memory; very large multitrack sessions need sufficient memory.
- Video uses a 16:9 frame at the selected Full HD or 4K resolution. Larger arrangements are scaled down to include the whole interface. 4K produces larger files and takes longer to render.
- Rendering happens frame by frame and can take longer than the audio duration.
- The local server must be deployed to a long-running Node environment; short-lived serverless functions are not appropriate for 200 MB uploads or video rendering.

## Project structure

- `app/components/`: editor, export dialog, video library, and browser hooks
- `app/api/`: uploads, background export submission, job status, and video downloads
- `app/studio-render/`: the isolated studio view captured by the renderer
- `lib/server/`: audio processing, render pipeline, and SQLite job storage
- `scripts/`: app launcher, render worker, and cleanup
- `tests/`: queue checks and real audio/video export tests
- `data/`: local uploads, exported videos, and render history (ignored by Git)

## Cleanup

```bash
npm run clean -- --dry-run
npm run clean
```

Cleanup removes generated test images, the TypeScript build cache, and scratch files from completed exports. It preserves uploaded audio, exported videos, render history, and active renders. Run it after tests finish; integration tests use the first-frame snapshots to verify lossless output. The active Next.js build and installed dependencies are retained.

## Checks

```bash
npm run typecheck
npm run test:jobs
npm run build
```

With the development server running on `127.0.0.1:3000`, run `npm run test:integration` to verify background submission, sequential rendering, saved job history, real progress, real uploads and MP4/MOV downloads, Full HD and 4K, all three quality presets, exact lossless video pixels, the actual studio design, separate colored lanes, animated clock/playhead/meters, stereo audio, offsets, gain, pan, mute/solo, countdowns, and validation. The test removes its own audio/video fixtures and saves video-frame images under `data/test-artifacts/` for visual inspection.
