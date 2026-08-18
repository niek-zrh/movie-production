"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Everywhere",
    keys: [
      ["⌘K", "Search shots, scenes, files"],
      ["?", "This overlay"],
    ],
  },
  {
    title: "Shots & files",
    keys: [
      ["N", "New shot"],
      ["/", "Search files"],
    ],
  },
  {
    title: "Review Room",
    keys: [
      ["1–4", "Compare 1–4 up"],
      ["←/→", "Move focus"],
      ["S", "Shortlist"],
      ["X", "Reject"],
      ["P", "Pick"],
      ["0", "Reset zoom"],
      ["F", "Fullscreen"],
      ["Esc", "Back to queue"],
    ],
  },
];

export function KeyboardOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.title}
              </h3>
              <ul className="space-y-1.5">
                {g.keys.map(([key, label]) => (
                  <li key={key} className="flex items-center gap-3 text-sm">
                    <kbd className="min-w-9 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-[11px]">
                      {key}
                    </kbd>
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Letter and digit shortcuts match the physical key, so a Russian
          (ЙЦУКЕН) layout triggers the same actions as an English one.
        </p>
      </DialogContent>
    </Dialog>
  );
}
