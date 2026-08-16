"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Plus, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/app/user-avatar";
import { useStudio } from "@/components/app/studio-context";
import {
  DriveConnectCard,
  showMutationError,
} from "@/components/app/drive-connect-card";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  "Europe/Zurich",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "UTC",
];

const PRODUCTION_STATUSES = ["active", "paused", "wrapped"] as const;

type LinkKind = "figma" | "sheet" | "miro" | "telegram" | "other";

const LINK_KINDS: { key: LinkKind; label: string }[] = [
  { key: "sheet", label: "Sheet" },
  { key: "figma", label: "Figma" },
  { key: "miro", label: "Miro" },
  { key: "telegram", label: "Telegram" },
  { key: "other", label: "Other" },
];

const SECTIONS = [
  { id: "details", label: "Details" },
  { id: "stages", label: "Stages & gates" },
  { id: "links", label: "Links" },
  { id: "drive", label: "Drive hub" },
  { id: "team", label: "Team" },
];

type StageRow = (typeof api.productions.listStages._returnType)[number];
type TeamMember = (typeof api.studios.team._returnType)[number];
type ExternalLinkRow = (typeof api.externalLinks.list._returnType)[number];

const STAGE_STATUS_LABEL: Record<StageRow["status"], string> = {
  not_started: "Not started",
  active: "Active",
  blocked: "Blocked",
  done: "Done",
};

export default function SettingsPage() {
  const params = useParams<{ productionId: string }>();
  const productionId = params.productionId as Id<"productions">;
  const { studioId, role } = useStudio();
  const canManage = role === "owner" || role === "producer";

  const production = useQuery(api.productions.get, { productionId });
  const stages = useQuery(api.productions.listStages, { productionId });
  const links = useQuery(api.externalLinks.list, { productionId });
  const team = useQuery(api.studios.team, studioId ? { studioId } : "skip");

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">
            Settings
          </h1>
          <nav className="mt-2 flex flex-wrap items-center gap-1 text-sm">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>

        <section id="details" className="scroll-mt-20">
          <DetailsCard
            productionId={productionId}
            production={production}
            canManage={canManage}
          />
        </section>

        <section id="stages" className="scroll-mt-20">
          <StagesCard stages={stages} team={team} canManage={canManage} />
        </section>

        <section id="links" className="scroll-mt-20">
          <LinksCard
            productionId={productionId}
            links={links}
            canManage={canManage}
          />
        </section>

        <section id="drive" className="scroll-mt-20">
          <DriveConnectCard
            productionId={productionId}
            returnTo={`/p/${productionId}/settings`}
            canManage={canManage}
          />
        </section>

        <section id="team" className="scroll-mt-20">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" /> Team
              </CardTitle>
              <CardDescription>
                Team is managed studio-wide — members, roles and craft titles
                apply to every production.
              </CardDescription>
              <CardAction>
                <Link
                  href="/team"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Open Team
                </Link>
              </CardAction>
            </CardHeader>
          </Card>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

function DetailsCard({
  productionId,
  production,
  canManage,
}: {
  productionId: Id<"productions">;
  production: typeof api.productions.get._returnType | undefined;
  canManage: boolean;
}) {
  const update = useMutation(api.productions.update);

  if (production === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const timezones = TIMEZONES.includes(production.timezone)
    ? TIMEZONES
    : [production.timezone, ...TIMEZONES];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          <span className="font-mono">{production.code}</span> ·{" "}
          {production.kind === "episodic"
            ? `Series · ${production.episodes.length} episodes`
            : "Feature"}
          {canManage && " · changes save as you go"}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="prod-name">Name</Label>
          {canManage ? (
            <NameInput
              key={production.name}
              productionId={productionId}
              initial={production.name}
            />
          ) : (
            <p className="text-sm">{production.name}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          {canManage ? (
            <Select
              value={production.status}
              onValueChange={(value) =>
                void update({
                  productionId,
                  status: value as (typeof PRODUCTION_STATUSES)[number],
                }).catch(showMutationError)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue className="capitalize" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm capitalize">{production.status}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Timezone</Label>
          {canManage ? (
            <Select
              value={production.timezone}
              onValueChange={(value) => {
                if (!value) return;
                void update({ productionId, timezone: value }).catch(
                  showMutationError,
                );
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm">{production.timezone}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NameInput({
  productionId,
  initial,
}: {
  productionId: Id<"productions">;
  initial: string;
}) {
  const update = useMutation(api.productions.update);
  const [value, setValue] = useState(initial);
  return (
    <Input
      id="prod-name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const next = value.trim();
        if (next && next !== initial)
          void update({ productionId, name: next }).catch(showMutationError);
        else setValue(initial);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Stages & gates
// ---------------------------------------------------------------------------

function StagesCard({
  stages,
  team,
  canManage,
}: {
  stages: StageRow[] | undefined;
  team: TeamMember[] | undefined;
  canManage: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stages &amp; gates</CardTitle>
        <CardDescription>
          Gate approvers sign off before a stage can close. Sign-off is
          requested from the board.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {stages === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          stages.map((stage, i) => (
            <div
              key={stage._id}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5",
                i > 0 && "border-t",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{stage.label}</p>
                <p className="text-xs text-muted-foreground">
                  Gate {stage.gateStatus.replace("_", " ")}
                  {stage.gateStatus === "rejected" && stage.gateNote
                    ? ` — ${stage.gateNote}`
                    : ""}
                </p>
              </div>
              <Badge
                variant={
                  stage.status === "blocked"
                    ? "destructive"
                    : stage.status === "active"
                      ? "secondary"
                      : "outline"
                }
                className={cn(
                  stage.status === "done" && "text-status-approved",
                  stage.status === "not_started" && "text-muted-foreground",
                )}
              >
                {STAGE_STATUS_LABEL[stage.status]}
              </Badge>
              <ApproversCell stage={stage} team={team} canManage={canManage} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ApproversCell({
  stage,
  team,
  canManage,
}: {
  stage: StageRow;
  team: TeamMember[] | undefined;
  canManage: boolean;
}) {
  const setGateApprovers = useMutation(api.productions.setGateApprovers);
  const members = (team ?? []).filter(
    (m): m is TeamMember & { userId: Id<"users"> } => m.userId !== undefined,
  );

  const namesPreview =
    stage.approvers.length > 0 ? (
      <span className="flex items-center gap-1.5">
        <span className="flex -space-x-1.5">
          {stage.approvers.slice(0, 3).map((a) => (
            <UserAvatar
              key={a._id}
              name={a.name}
              image={a.image}
              className="ring-1 ring-background"
            />
          ))}
        </span>
        <span className="max-w-40 truncate text-xs text-muted-foreground">
          {stage.approvers.map((a) => a.name).join(", ")}
        </span>
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">No approvers</span>
    );

  if (!canManage) return namesPreview;

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" />}
      >
        {namesPreview}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="px-0.5 text-xs font-medium text-muted-foreground">
          Gate approvers — {stage.label}
        </p>
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {members.length === 0 && (
            <p className="px-0.5 py-1 text-xs text-muted-foreground">
              No members with accounts yet.
            </p>
          )}
          {members.map((member) => {
            const checked = stage.gateApproverIds.includes(member.userId);
            return (
              <label
                key={member._id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => {
                    const ids = next
                      ? [...stage.gateApproverIds, member.userId]
                      : stage.gateApproverIds.filter(
                          (id) => id !== member.userId,
                        );
                    void setGateApprovers({
                      stageInstanceId: stage._id,
                      approverIds: ids,
                    }).catch(showMutationError);
                  }}
                />
                <UserAvatar name={member.name} image={member.image} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {member.name}
                </span>
                <span className="text-[10px] text-muted-foreground capitalize">
                  {member.role.replace("_", " ")}
                </span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

function LinksCard({
  productionId,
  links,
  canManage,
}: {
  productionId: Id<"productions">;
  links: ExternalLinkRow[] | undefined;
  canManage: boolean;
}) {
  const remove = useMutation(api.externalLinks.remove);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Links</CardTitle>
        <CardDescription>
          Budget, boards and chat — everything the production leans on.
        </CardDescription>
        {canManage && (
          <CardAction>
            <AddLinkDialog productionId={productionId} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {links === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No links yet.{canManage && " Add the budget sheet or Figma board."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Kind</TableHead>
                  <TableHead className="w-56">Title</TableHead>
                  <TableHead>URL</TableHead>
                  {canManage && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => (
                  <TableRow key={link._id}>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {link.kind}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <LinkFieldInput
                          key={`t-${link._id}-${link.title}`}
                          linkId={link._id}
                          field="title"
                          initial={link.title}
                        />
                      ) : (
                        <span className="text-sm">{link.title}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <div className="flex items-center gap-1.5">
                          <LinkFieldInput
                            key={`u-${link._id}-${link.url}`}
                            linkId={link._id}
                            field="url"
                            initial={link.url}
                            mono
                          />
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Open ${link.title}`}
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                      ) : (
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-72 items-center gap-1.5 truncate text-sm underline-offset-4 hover:underline"
                        >
                          <span className="truncate">{link.url}</span>
                          <ExternalLink className="size-3.5 shrink-0" />
                        </a>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() =>
                            void remove({ linkId: link._id }).catch(
                              showMutationError,
                            )
                          }
                        >
                          Remove
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinkFieldInput({
  linkId,
  field,
  initial,
  mono = false,
}: {
  linkId: Id<"externalLinks">;
  field: "title" | "url";
  initial: string;
  mono?: boolean;
}) {
  const update = useMutation(api.externalLinks.update);
  const [value, setValue] = useState(initial);
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className={cn("h-7 min-w-40 text-sm", mono && "font-mono text-xs")}
      onBlur={() => {
        const next = value.trim();
        if (next && next !== initial)
          void update({ linkId, [field]: next }).catch(showMutationError);
        else setValue(initial);
      }}
    />
  );
}

function AddLinkDialog({ productionId }: { productionId: Id<"productions"> }) {
  const add = useMutation(api.externalLinks.add);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LinkKind>("sheet");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="size-3.5" /> Add link
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Add a link</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await add({ productionId, kind, title: title.trim(), url: url.trim() });
              setOpen(false);
              setTitle("");
              setUrl("");
            } catch (err) {
              showMutationError(err);
            }
          }}
        >
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as LinkKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_KINDS.map((k) => (
                    <SelectItem key={k.key} value={k.key}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-title">Title</Label>
              <Input
                id="link-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Budget sheet"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!title.trim() || !url.trim()}>
              Add link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
