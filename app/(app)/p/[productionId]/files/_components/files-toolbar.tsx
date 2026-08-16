"use client";

import type { RefObject } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export type FilesFilter = "all" | "unassigned" | "uploads" | "missing";

const FILTERS: { key: FilesFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unassigned", label: "Unassigned" },
  { key: "uploads", label: "App uploads" },
  { key: "missing", label: "Missing" },
];

export function FilesToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  hubConnected,
  syncing,
  onSync,
  searchRef,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filter: FilesFilter;
  onFilterChange: (filter: FilesFilter) => void;
  hubConnected: boolean;
  syncing: boolean;
  onSync: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files…"
          aria-label="Search files"
          className="w-52 pl-8"
        />
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "secondary" : "ghost"}
            className={cn(
              "rounded-full",
              filter !== f.key && "text-muted-foreground",
            )}
            aria-pressed={filter === f.key}
            onClick={() => onFilterChange(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="ms-auto">
        {hubConnected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={syncing}
          >
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {copy.actions.syncNow}
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button variant="outline" size="sm" disabled>
                  <RefreshCw />
                  {copy.actions.syncNow}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Connect the Drive hub in Settings to sync
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}
