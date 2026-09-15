"use client";

import { memo, useEffect, useRef } from "react";
import type { WaveformDensity, WaveformStyle } from "@/lib/types";

export const Waveform = memo(function Waveform({ channels, style, density }: { channels: number[][]; style: WaveformStyle; density: WaveformDensity }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.scale(ratio, ratio);
      context.fillStyle = "#082f35";
      const channelHeight = height / channels.length;
      channels.forEach((peaks, channel) => {
        const center = channelHeight * (channel + 0.5);
        const spacing = style === "wave" ? (density === "low" ? 5 : density === "high" ? 1 : 2) : (density === "low" ? 8 : density === "high" ? 3 : 5);
        const count = Math.max(2, Math.floor(width / spacing));
        const amplitudes = Array.from({ length: count }, (_, index) => {
          const from = Math.floor(index / count * peaks.length);
          const to = Math.max(from + 1, Math.floor((index + 1) / count * peaks.length));
          let peak = 0;
          for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(peaks[i] || 0));
          return Math.max(0.6, Math.pow(peak, 1.35) * channelHeight * 0.4);
        });
        context.globalAlpha = 0.15;
        context.fillRect(0, center, width, 1);
        context.globalAlpha = 1;
        if (style === "wave") {
          context.beginPath();
          amplitudes.forEach((amp, i) => { const x = i / (count - 1) * width; if (i === 0) context.moveTo(x, center - amp); else context.lineTo(x, center - amp); });
          for (let i = count - 1; i >= 0; i--) context.lineTo(i / (count - 1) * width, center + amplitudes[i]);
          context.closePath();
          context.fill();
        } else {
          amplitudes.forEach((amp, i) => {
            const x = i / count * width;
            context.beginPath();
            if (style === "particles") {
              for (let y = center - amp; y <= center + amp; y += spacing) { context.moveTo(x + 1.3, y); context.arc(x, y, 1.3, 0, Math.PI * 2); }
            } else context.roundRect(x, center - amp, spacing * 0.65, amp * 2, style === "rounded" ? spacing / 2 : 0);
            context.fill();
          });
        }
        if (channel) {
          context.globalAlpha = 0.18;
          context.fillRect(0, channel * channelHeight, width, 1);
          context.globalAlpha = 1;
        }
      });
      canvas.dataset.rendered = "true";
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [channels, style, density]);
  return <canvas className="track-waveform" ref={ref} aria-label={`${channels.length === 2 ? "Stereo" : "Mono"} audio waveform`} role="img" />;
});
