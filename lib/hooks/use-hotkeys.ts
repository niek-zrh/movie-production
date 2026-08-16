"use client";

import { useEffect, useRef } from "react";

type HotkeyHandler = (e: KeyboardEvent) => void;

/**
 * Keyboard shortcuts (spec §9.3 — keyboard-first where daily users live).
 * Keys: "s", "x", "p", "1".."4", "arrowleft", "f", "?", "mod+k", "escape"…
 * Ignores events from inputs/textareas/contenteditable unless prefixed "mod+".
 */
export function useHotkeys(
  map: Record<string, HotkeyHandler>,
  enabled = true,
) {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const key = `${e.metaKey || e.ctrlKey ? "mod+" : ""}${e.key.toLowerCase()}`;
      const handler = mapRef.current[key];
      if (!handler) return;
      if (inField && !key.startsWith("mod+") && key !== "escape") return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
