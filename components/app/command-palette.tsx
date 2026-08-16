"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Clapperboard, File, Film, ListVideo } from "lucide-react";

/** Global ⌘K search over shots / scenes / productions / files (spec §9.1). */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery(
    api.search.global,
    open && debounced.length >= 2 ? { q: debounced } : "skip",
  );

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search">
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search shots, scenes, files…"
          value={q}
          onValueChange={setQ}
        />
        <CommandList>
        <CommandEmpty>
          {debounced.length < 2 ? "Type at least two characters." : "No results."}
        </CommandEmpty>
        {results && results.shots.length > 0 && (
          <CommandGroup heading="Shots">
            {results.shots.map((s) => (
              <CommandItem
                key={s._id}
                value={s._id}
                onSelect={() => go(`/p/${s.productionId}/shots/${s._id}`)}
              >
                <Film className="size-4" />
                <span className="font-mono text-xs">{s.code}</span>
                <span className="truncate text-muted-foreground">
                  {s.title ?? ""}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {s.productionName}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results && results.scenes.length > 0 && (
          <CommandGroup heading="Scenes">
            {results.scenes.map((s) => (
              <CommandItem
                key={s._id}
                value={s._id}
                onSelect={() => go(`/p/${s.productionId}/shots?scene=${s._id}`)}
              >
                <ListVideo className="size-4" />
                <span className="font-mono text-xs">{s.code}</span>
                <span className="truncate text-muted-foreground">
                  {s.title ?? ""}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results && results.productions.length > 0 && (
          <CommandGroup heading="Productions">
            {results.productions.map((p) => (
              <CommandItem
                key={p._id}
                value={p._id}
                onSelect={() => go(`/p/${p._id}`)}
              >
                <Clapperboard className="size-4" />
                <span>{p.name}</span>
                <span className="ml-1 font-mono text-xs text-muted-foreground">
                  {p.code}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results && results.assets.length > 0 && (
          <CommandGroup heading="Files">
            {results.assets.map((a) => (
              <CommandItem
                key={a._id}
                value={a._id}
                onSelect={() =>
                  go(
                    a.shotId
                      ? `/p/${a.productionId}/shots/${a.shotId}`
                      : `/p/${a.productionId}/files`,
                  )
                }
              >
                <File className="size-4" />
                <span className="truncate">{a.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {a.productionName}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
