"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { copy } from "@/lib/copy";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NotificationsBell() {
  const notifications = useQuery(api.notifications.list, { limit: 30 });
  const unread = useQuery(api.notifications.unreadCount);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const router = useRouter();

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "relative",
        )}
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unread !== undefined && unread > 0 && (
          <span className="absolute right-1 top-1 flex size-2 rounded-full bg-tape" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => void markAllRead()}
          >
            {copy.actions.markAllRead}
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {notifications === undefined ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {copy.empty.notifications}
            </p>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => (
                <li key={n._id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-accent",
                      !n.readAt && "bg-tape/5",
                    )}
                    onClick={() => {
                      void markRead({ notificationId: n._id });
                      if (n.href) router.push(n.href);
                    }}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      {!n.readAt && (
                        <span className="size-1.5 shrink-0 rounded-full bg-tape" />
                      )}
                      <span className="truncate font-medium">{n.title}</span>
                    </span>
                    {n.body && (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {n.body}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {formatWhen(n._creationTime)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
