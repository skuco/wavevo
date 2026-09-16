"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export function SessionTitle({ value, onChange, readOnly = false }: { value: string; onChange: (value: string) => void; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (editing) { input.current?.focus(); input.current?.select(); }
  }, [editing]);

  const finish = () => {
    if (!cancelled.current) onChange(draft.trim() || "Untitled session");
    setEditing(false);
  };

  return (
    <h1 className="session-title" title={value}>
      {readOnly ? value : editing ? (
        <input
          ref={input}
          className="session-title-input"
          aria-label="Session name"
          value={draft}
          maxLength={120}
          onChange={event => setDraft(event.target.value)}
          onBlur={finish}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelled.current = event.key === "Escape";
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <button type="button" className="session-title-button" aria-label={`Rename session: ${value}`} title="Click to rename session" onClick={() => { setDraft(value); cancelled.current = false; setEditing(true); }}>
          <span>{value}</span><Icon name="edit" size={13} />
        </button>
      )}
    </h1>
  );
}
