"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionTrack } from "@/lib/types";

type AudioEntry = { buffer?: AudioBuffer; gain: GainNode; pan: StereoPannerNode; analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; source?: AudioBufferSourceNode; abort: AbortController };

export function useTransport(tracks: SessionTrack[], masterVolume: number, loop: boolean) {
  const context = useRef<AudioContext | null>(null);
  const master = useRef<GainNode | null>(null);
  const entries = useRef(new Map<string, AudioEntry>());
  const tracksRef = useRef(tracks);
  const loopRef = useRef(loop);
  const position = useRef(0);
  const startedAt = useRef(0);
  const running = useRef(false);
  const frame = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [levels, setLevels] = useState<Record<string, number>>({});
  tracksRef.current = tracks;
  loopRef.current = loop;
  const duration = Math.max(0, ...tracks.map(track => track.start + track.duration));

  const stopSources = useCallback(() => {
    for (const entry of entries.current.values()) {
      if (entry.source) { entry.source.stop(); entry.source.disconnect(); entry.source = undefined; }
    }
  }, []);

  const pause = useCallback(() => {
    if (running.current && context.current) position.current += Math.max(0, context.current.currentTime - startedAt.current);
    running.current = false;
    stopSources();
    setPlaying(false);
    setCurrentTime(position.current);
    setLevels({});
  }, [stopSources]);

  const startSources = useCallback(() => {
    const audioContext = context.current;
    if (!audioContext) return;
    stopSources();
    const when = audioContext.currentTime + 0.035;
    startedAt.current = when;
    for (const track of tracksRef.current) {
      const entry = entries.current.get(track.id);
      if (!entry?.buffer || position.current >= track.start + track.duration) continue;
      const source = audioContext.createBufferSource();
      source.buffer = entry.buffer;
      source.connect(entry.gain);
      const offset = Math.max(0, position.current - track.start);
      if (offset >= entry.buffer.duration) continue;
      source.start(when + Math.max(0, track.start - position.current), offset, Math.min(entry.buffer.duration - offset, track.duration - offset));
      entry.source = source;
    }
    running.current = true;
    setPlaying(true);
  }, [stopSources]);

  const play = useCallback(async () => {
    const audioContext = context.current;
    if (!audioContext || !tracksRef.current.length || tracksRef.current.some(track => !entries.current.get(track.id)?.buffer)) return;
    try {
      await audioContext.resume();
      const end = Math.max(...tracksRef.current.map(track => track.start + track.duration));
      if (position.current >= end) position.current = 0;
      startSources();
    } catch { setError("Audio playback could not start. Try pressing Play again."); }
  }, [startSources]);

  const seek = useCallback((time: number) => {
    const end = Math.max(0, ...tracksRef.current.map(track => track.start + track.duration));
    position.current = Math.max(0, Math.min(end, time));
    setCurrentTime(position.current);
    if (running.current) startSources();
  }, [startSources]);

  useEffect(() => {
    for (const [id, entry] of entries.current) {
      if (!tracks.some(track => track.id === id)) {
        entry.abort.abort(); entry.source?.stop(); entry.source?.disconnect(); entry.gain.disconnect(); entry.pan.disconnect(); entry.analyser.disconnect();
        entries.current.delete(id);
      }
    }
    if (!tracks.length) return;
    if (!context.current) {
      context.current = new AudioContext();
      master.current = context.current.createGain();
      master.current.connect(context.current.destination);
    }
    const audioContext = context.current;
    const anySolo = tracks.some(track => track.solo);
    for (const track of tracks) {
      let entry = entries.current.get(track.id);
      if (!entry) {
        const gain = audioContext.createGain();
        const pan = audioContext.createStereoPanner();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        gain.connect(pan).connect(analyser).connect(master.current!);
        entry = { gain, pan, analyser, samples: new Float32Array(256), abort: new AbortController() };
        entries.current.set(track.id, entry);
        const pending = entry;
        void fetch(track.audioUrl, { signal: pending.abort.signal }).then(response => {
          if (!response.ok) throw new Error("Could not load audio");
          return response.arrayBuffer();
        }).then(data => audioContext.decodeAudioData(data)).then(buffer => {
          if (pending.abort.signal.aborted) return;
          pending.buffer = buffer;
          setLoaded([...entries.current].filter(([, value]) => value.buffer).map(([id]) => id));
        }).catch(caught => {
          if (!pending.abort.signal.aborted) setError(`Could not prepare ${track.name} for playback. Remove it and try adding it again. ${caught instanceof Error ? caught.message : ""}`);
        });
      }
      entry.gain.gain.setTargetAtTime(track.muted || (anySolo && !track.solo) ? 0 : track.volume, audioContext.currentTime, 0.015);
      entry.pan.pan.setTargetAtTime(track.pan, audioContext.currentTime, 0.015);
    }
  }, [tracks]);

  useEffect(() => {
    if (master.current && context.current) master.current.gain.setTargetAtTime(masterVolume, context.current.currentTime, 0.015);
  }, [masterVolume, tracks.length]);

  useEffect(() => {
    let lastMeter = 0;
    const tick = (now: number) => {
      if (running.current && context.current) {
        let time = position.current + Math.max(0, context.current.currentTime - startedAt.current);
        const end = Math.max(0, ...tracksRef.current.map(track => track.start + track.duration));
        if (time >= end) {
          if (loopRef.current && end > 0) { position.current = 0; startSources(); time = 0; }
          else { running.current = false; stopSources(); position.current = end; time = end; setPlaying(false); setLevels({}); }
        }
        setCurrentTime(time);
        if (running.current && now - lastMeter > 65) {
          const nextLevels: Record<string, number> = {};
          entries.current.forEach((entry, id) => {
            entry.analyser.getFloatTimeDomainData(entry.samples);
            let peak = 0;
            for (const value of entry.samples) peak = Math.max(peak, Math.abs(value));
            nextLevels[id] = Math.min(1, peak);
          });
          setLevels(nextLevels);
          lastMeter = now;
        }
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [startSources, stopSources]);

  useEffect(() => () => {
    running.current = false;
    stopSources();
    entries.current.forEach(entry => entry.abort.abort());
    entries.current.clear();
    void context.current?.close();
    context.current = null;
    master.current = null;
  }, [stopSources]);

  return { playing, currentTime, duration, levels, error, clearError: () => setError(""), ready: tracks.length > 0 && tracks.every(track => loaded.includes(track.id)), play, pause, seek };
}
