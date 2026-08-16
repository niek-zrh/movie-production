"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
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

const STEPS = [
  { n: 1, label: "Details" },
  { n: 2, label: "Drive" },
  { n: 3, label: "Links" },
] as const;

type LinkKind = "sheet" | "figma" | "miro" | "telegram";

const LINK_ROWS: { kind: LinkKind; label: string; placeholder: string }[] = [
  {
    kind: "sheet",
    label: "Budget sheet",
    placeholder: "https://docs.google.com/spreadsheets/…",
  },
  {
    kind: "figma",
    label: "Figma storyboards",
    placeholder: "https://www.figma.com/…",
  },
  { kind: "miro", label: "Miro board", placeholder: "https://miro.com/…" },
  { kind: "telegram", label: "Telegram group", placeholder: "https://t.me/…" },
];

type LinkRowState = { title: string; url: string; added: boolean };

/** Auto-suggest a production code from the name's initials (spec F2). */
function suggestCode(name: string): string {
  const initials = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .join("")
    .slice(0, 6);
  if (initials.length >= 2) return initials;
  // Single short word → first three characters instead of one initial.
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);
}

export default function NewProductionPage() {
  // useSearchParams needs a Suspense boundary for prerendering.
  return (
    <Suspense fallback={null}>
      <NewProductionWizard />
    </Suspense>
  );
}

function NewProductionWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { studioId, role, viewer } = useStudio();
  const canManage = role === "owner" || role === "producer";

  // The OAuth flow returns to /new?step=2&p={id} — resume from there. The
  // callback may append "?status=connected" to an already-query-carrying
  // path, so strip anything after a stray "?" inside a param value.
  const [productionId, setProductionId] = useState<Id<"productions"> | null>(
    () => {
      const raw = searchParams.get("p")?.split("?")[0];
      return raw ? (raw as Id<"productions">) : null;
    },
  );
  const [step, setStep] = useState<1 | 2 | 3>(() => {
    const raw = searchParams.get("step")?.split("?")[0];
    const hasProduction = searchParams.get("p") !== null;
    if (hasProduction && raw === "3") return 3;
    if (hasProduction && raw === "2") return 2;
    return 1;
  });

  // Step 1 state
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [kind, setKind] = useState<"feature" | "episodic">("feature");
  const [episodeCount, setEpisodeCount] = useState("8");
  const [timezone, setTimezone] = useState("Europe/Zurich");
  const [creating, setCreating] = useState(false);

  // Step 3 state
  const [rows, setRows] = useState<Record<LinkKind, LinkRowState>>(() =>
    Object.fromEntries(
      LINK_ROWS.map((row) => [
        row.kind,
        { title: row.label, url: "", added: false },
      ]),
    ) as Record<LinkKind, LinkRowState>,
  );
  const [finishing, setFinishing] = useState(false);

  const createProduction = useMutation(api.productions.create);
  const addLink = useMutation(api.externalLinks.add);
  const driveStatus = useQuery(
    api.drive.connectionStatus,
    step === 2 && productionId ? { productionId } : "skip",
  );

  const codeValid = /^[A-Z0-9]{2,6}$/.test(code);
  const episodes = Math.max(1, Number.parseInt(episodeCount, 10) || 1);

  const onCreate = async () => {
    if (!studioId) return;
    setCreating(true);
    try {
      const id = await createProduction({
        studioId,
        name: name.trim(),
        code,
        kind,
        ...(kind === "episodic" ? { episodeCount: episodes } : {}),
        timezone,
      });
      setProductionId(id);
      setStep(2);
    } catch (e) {
      showMutationError(e);
    } finally {
      setCreating(false);
    }
  };

  const onFinish = async () => {
    if (!productionId) return;
    setFinishing(true);
    try {
      for (const row of LINK_ROWS) {
        const state = rows[row.kind];
        if (state.added || !state.url.trim()) continue;
        await addLink({
          productionId,
          kind: row.kind,
          title: state.title.trim() || row.label,
          url: state.url.trim(),
        });
        setRows((prev) => ({
          ...prev,
          [row.kind]: { ...prev[row.kind], added: true },
        }));
      }
      router.push(`/p/${productionId}`);
    } catch (e) {
      showMutationError(e);
      setFinishing(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        New production
      </h1>

      <ol className="mt-4 mb-6 flex items-center gap-1 text-sm">
        {STEPS.map((s, i) => {
          const done = s.n < step || (s.n === 1 && productionId !== null);
          const current = s.n === step;
          // Steps 2↔3 are freely navigable once the production exists.
          const clickable = s.n !== 1 && productionId !== null && !current;
          return (
            <li key={s.n} className="flex items-center gap-1">
              {i > 0 && (
                <span className="mx-1 text-muted-foreground/50" aria-hidden>
                  ·
                </span>
              )}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && setStep(s.n as 2 | 3)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-1.5 py-0.5",
                  clickable && "hover:bg-muted",
                  !clickable && "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px] font-medium",
                    current
                      ? "bg-primary text-primary-foreground"
                      : done
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {done && !current ? <Check className="size-3" /> : s.n}
                </span>
                <span
                  className={cn(
                    current ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {viewer === undefined ? (
        <Skeleton className="h-72 w-full" />
      ) : !canManage ? (
        <EmptyState title="Only owners and producers can set up a production. Ask a producer to create it, or check your role on the Team page." />
      ) : step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Name it, give it a short code for filenames, and set the clock it
              runs on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void onCreate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="prod-name">Name</Label>
                  <Input
                    id="prod-name"
                    value={name}
                    autoFocus
                    placeholder="Signal Lost"
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!codeTouched) setCode(suggestCode(e.target.value));
                    }}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prod-code">Code</Label>
                  <Input
                    id="prod-code"
                    value={code}
                    placeholder="SGL"
                    className="font-mono uppercase"
                    onChange={(e) => {
                      setCodeTouched(true);
                      setCode(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, "")
                          .slice(0, 6),
                      );
                    }}
                    aria-invalid={code.length > 0 && !codeValid}
                  />
                  <p className="text-xs text-muted-foreground">
                    2–6 chars, used in filenames
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Kind</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={kind === "feature" ? "default" : "outline"}
                    onClick={() => setKind("feature")}
                  >
                    Feature
                  </Button>
                  <Button
                    type="button"
                    variant={kind === "episodic" ? "default" : "outline"}
                    onClick={() => setKind("episodic")}
                  >
                    Episodic
                  </Button>
                  {kind === "episodic" && (
                    <div className="ml-2 flex items-center gap-2">
                      <Label
                        htmlFor="prod-episodes"
                        className="text-muted-foreground"
                      >
                        Episodes
                      </Label>
                      <Input
                        id="prod-episodes"
                        type="number"
                        min={1}
                        max={99}
                        value={episodeCount}
                        onChange={(e) => setEpisodeCount(e.target.value)}
                        className="w-18"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Select
                  value={timezone}
                  onValueChange={(v) => {
                    if (v) setTimezone(v);
                  }}
                >
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Daily reports compile at 18:00 in this timezone.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={!name.trim() || !codeValid || !studioId || creating}
                >
                  {creating && <Loader2 className="size-4 animate-spin" />}
                  Create &amp; continue
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : !productionId ? (
        <EmptyState title="This step needs a production. Start again from step 1." />
      ) : step === 2 ? (
        <div className="flex flex-col gap-4">
          <DriveConnectCard
            productionId={productionId}
            returnTo={`/new?step=2&p=${productionId}`}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setStep(3)}>
              Skip for now
            </Button>
            {driveStatus?.hub.connected && (
              <Button onClick={() => setStep(3)}>Continue</Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Links</CardTitle>
              <CardDescription>
                Where the rest of the production lives — budget, boards and the
                group chat. All optional; anything filled in is added when you
                open the production.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {LINK_ROWS.map((row) => {
                const state = rows[row.kind];
                const setRow = (patch: Partial<LinkRowState>) =>
                  setRows((prev) => ({
                    ...prev,
                    [row.kind]: { ...prev[row.kind], ...patch },
                  }));
                return (
                  <div key={row.kind} className="space-y-1.5">
                    <Label htmlFor={`link-${row.kind}`}>{row.label}</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={state.title}
                        aria-label={`${row.label} title`}
                        className="w-full sm:w-44"
                        disabled={state.added}
                        onChange={(e) => setRow({ title: e.target.value })}
                      />
                      <Input
                        id={`link-${row.kind}`}
                        type="url"
                        value={state.url}
                        placeholder={row.placeholder}
                        className="min-w-0 flex-1"
                        disabled={state.added}
                        onChange={(e) => setRow({ url: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={state.added || !state.url.trim()}
                        onClick={() =>
                          void addLink({
                            productionId,
                            kind: row.kind,
                            title: state.title.trim() || row.label,
                            url: state.url.trim(),
                          })
                            .then(() => setRow({ added: true }))
                            .catch(showMutationError)
                        }
                      >
                        {state.added ? (
                          <>
                            <Check className="size-3.5" /> Added
                          </>
                        ) : (
                          "Add"
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button onClick={() => void onFinish()} disabled={finishing}>
              {finishing && <Loader2 className="size-4 animate-spin" />}
              Open production
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
