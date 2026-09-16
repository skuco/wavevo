"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";

export function SnapHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="snap-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!ref.current?.contains(document.activeElement)) setOpen(false); }}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button type="button" className="icon-button snap-info-button" aria-label="How Snap works" aria-describedby={open ? id : undefined} aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon name="info" size={15} />
      </button>
      {open && (
        <span id={id} role="tooltip" className="snap-tooltip">
          <strong>Snap to time intervals</strong>
          <span>Align dragged tracks and timeline clicks to the nearest interval in the dropdown: 1 second, ½ second, or 0.1 second.</span>
          <span>With 1-second Snap, dropping a track at 2.7s places it at 3s. Smaller intervals give finer control.</span>
          <span className="snap-tooltip-note">Turn Snap off to position tracks freely.</span>
        </span>
      )}
    </span>
  );
}
