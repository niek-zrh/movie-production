"use client";

import { useEffect, useRef } from "react";

type HotkeyHandler = (e: KeyboardEvent) => void;

type HotkeyMap = Record<string, HotkeyHandler>;

type HotkeyOptions = {
  /** Shadow the same binding in every other map while this one is mounted. */
  exclusive?: boolean;
};

/**
 * Maps that shadow the others. The Review Room registers one so "?" opens the
 * room's own dark hints and not also the app shell's light overlay stacked on
 * top of it — window listeners all fire, so someone has to yield.
 */
const exclusiveMaps = new Set<{ current: HotkeyMap }>();

/**
 * Binding names this event could match, most layout-independent first.
 *
 * `e.key` is whatever the LAYOUT produced: on ЙЦУКЕН the physical S key
 * arrives as "ы", P as "з", and Cmd+K as "mod+л", so a key-based lookup dies
 * for the Russian-speaking studios this ships to. Letters and digits resolve
 * from `e.code` (KeyS, Digit2) instead — that is the physical key, identical
 * on every layout. `e.key` stays as the fallback so punctuation bindings
 * ("?" = Shift+Slash on US, Shift+7 on ЙЦУКЕН; "/"), the arrows and Escape
 * still resolve. The numpad is deliberately not read from `e.code`: with
 * NumLock on it already arrives as a plain digit in `e.key`, and with NumLock
 * off Numpad4 must stay ArrowLeft.
 */
function bindingCandidates(e: KeyboardEvent): string[] {
  const mod = e.metaKey || e.ctrlKey ? "mod+" : "";
  const fromKey = e.key.toLowerCase();
  // Alt/AltGr composes characters on many layouts — leave those to e.key.
  const physical = e.altKey
    ? undefined
    : (/^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase() ??
      /^Digit([0-9])$/.exec(e.code)?.[1]);
  const names =
    physical === undefined
      ? [fromKey]
      : e.shiftKey
        ? // A shifted character ("?") wins over the physical key under it.
          [fromKey, physical]
        : [physical, fromKey];
  return names.map((name) => `${mod}${name}`);
}

/**
 * Keyboard shortcuts (spec §9.3 — keyboard-first where daily users live).
 * Keys: "s", "x", "p", "1".."4", "arrowleft", "f", "?", "mod+k", "escape"…
 * Letters and digits match the physical key, so every layout works.
 * Ignores events from inputs/textareas/contenteditable unless prefixed "mod+".
 */
export function useHotkeys(
  map: HotkeyMap,
  enabled = true,
  options: HotkeyOptions = {},
) {
  const mapRef = useRef(map);
  mapRef.current = map;
  const exclusive = options.exclusive === true;

  useEffect(() => {
    if (!enabled) return;
    if (exclusive) exclusiveMaps.add(mapRef);
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const candidates = bindingCandidates(e);
      const key = candidates.find((c) => mapRef.current[c] !== undefined);
      if (key === undefined) return;
      // An exclusive map owns this binding while it is mounted.
      if (
        !exclusive &&
        [...exclusiveMaps].some((other) =>
          candidates.some((c) => other.current[c] !== undefined),
        )
      ) {
        return;
      }
      const handler = mapRef.current[key];
      if (handler === undefined) return;
      if (inField && !key.startsWith("mod+")) {
        // Escape typed in a field dismisses that field, not the screen behind
        // it — a half-written Review Room comment shouldn't cost the draft.
        // Dialogs run their own Escape handling, so leave focus alone there.
        if (
          key === "escape" &&
          target !== null &&
          target.closest('[role="dialog"]') === null
        ) {
          target.blur();
        }
        return;
      }
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      exclusiveMaps.delete(mapRef);
    };
  }, [enabled, exclusive]);
}
