"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Clapperboard, LogOut, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandPalette } from "./command-palette";
import { CreateStudio } from "./create-studio";
import { KeyboardOverlay } from "./keyboard-overlay";
import { NotificationsBell } from "./notifications-bell";
import { StudioProvider, useStudio } from "./studio-context";
import { UserAvatar } from "./user-avatar";
import { useHotkeys } from "@/lib/hooks/use-hotkeys";
import { copy } from "@/lib/copy";

function Shell({ children }: { children: ReactNode }) {
  const { viewer, studioId, setStudioId } = useStudio();
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useHotkeys({
    "mod+k": () => setSearchOpen(true),
    "?": () => setHelpOpen((v) => !v),
  });

  if (viewer === undefined) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="flex h-12 items-center gap-3 border-b px-4">
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-40 w-full max-w-3xl" />
        </div>
      </div>
    );
  }

  if (viewer === null) return null; // middleware redirects to /sign-in

  if (viewer.studios.length === 0) return <CreateStudio />;

  const activeStudio = viewer.studios.find((s) => s._id === studioId);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
        <Link
          href="/"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          aria-label="Slate home"
        >
          <Clapperboard className="size-4" />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent"
            aria-label="Switch studio"
          >
            {activeStudio?.name}
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Studios</DropdownMenuLabel>
              {viewer.studios.map((s) => (
                <DropdownMenuItem key={s._id} onClick={() => setStudioId(s._id)}>
                  <span className="flex-1 truncate">{s.name}</span>
                  {s._id === studioId && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/team")}>
              <Users className="size-4" /> {copy.nav.team}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="size-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
              ⌘K
            </kbd>
          </Button>
          <NotificationsBell />
          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded-full p-1 hover:bg-accent"
              aria-label="Account"
            >
              <UserAvatar name={viewer.name} image={viewer.image} className="size-7" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <div className="truncate">{viewer.name}</div>
                  <div className="truncate text-xs font-normal text-muted-foreground">
                    {viewer.email}
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  void signOut().then(() => router.push("/sign-in"))
                }
              >
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <KeyboardOverlay open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <StudioProvider>
      <Shell>{children}</Shell>
    </StudioProvider>
  );
}
