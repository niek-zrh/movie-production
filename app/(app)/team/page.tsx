"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/app/user-avatar";
import { useStudio } from "@/components/app/studio-context";
import { showMutationError } from "@/components/app/drive-connect-card";
import { ROLES, type RoleKey } from "@/convex/lib/domain";
import { copy } from "@/lib/copy";

export default function TeamPage() {
  const { studioId, role } = useStudio();
  const team = useQuery(api.studios.team, studioId ? { studioId } : "skip");
  const updateMember = useMutation(api.studios.updateMember);
  const canManage = role === "owner" || role === "producer";
  // Only an owner can create another owner (studios.updateMember enforces the
  // same rank rule server-side — this just keeps the menu honest).
  const assignableRoles =
    role === "owner" ? ROLES : ROLES.filter((r) => r.key !== "owner");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Team
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Craft titles are free text; the role decides what someone can do.
          </p>
        </div>
        {canManage && studioId && <InviteDialog studioId={studioId} />}
      </div>

      {team === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Craft title</TableHead>
                <TableHead className="w-44">Role</TableHead>
                {canManage && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((m) => (
                <TableRow key={m._id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={m.name} image={m.image} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 truncate text-sm font-medium">
                          {m.name}
                          {m.pending && (
                            <Badge variant="outline" className="text-[10px]">
                              Invited
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <CraftTitleInput
                        membershipId={m._id}
                        initial={m.craftTitle ?? ""}
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {m.craftTitle ?? "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Select
                        value={m.role}
                        onValueChange={(value) =>
                          void updateMember({
                            membershipId: m._id,
                            role: value as RoleKey,
                          }).catch((e) =>
                            toast.error(
                              e instanceof Error ? e.message : "Could not change role",
                            ),
                          )
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-40"
                          aria-label={`Role of ${m.name}`}
                        >
                          <SelectValue>
                            {ROLES.find((r) => r.key === m.role)?.label ??
                              m.role}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {/* Nobody hands out a role above their own — the
                              server refuses it (studios.updateMember), so
                              don't offer the choice either. */}
                          {assignableRoles.map((r) => (
                            <SelectItem key={r.key} value={r.key}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm capitalize">
                        {m.role.replace("_", " ")}
                      </span>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <RemoveMemberButton membershipId={m._id} name={m.name} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}

/**
 * Removing a member revokes their access to the whole studio the moment it
 * lands, so it confirms first (destructive actions confirm — conventions),
 * shows a busy state while the mutation is in flight and says what happened.
 */
function RemoveMemberButton({
  membershipId,
  name,
}: {
  membershipId: Id<"memberships">;
  name: string;
}) {
  const removeMember = useMutation(api.studios.removeMember);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" className="text-muted-foreground" />
        }
      >
        Remove
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">
            Remove {name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            They lose access to this studio and every production in it right
            away. Invite them again to bring them back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={removing}
            onClick={async () => {
              setRemoving(true);
              try {
                await removeMember({ membershipId });
                toast.success(`${name} removed from the studio`);
                setOpen(false);
              } catch (err) {
                // Stays open on failure (e.g. "You can't remove yourself") so
                // the toast reads next to the row it is about.
                showMutationError(err);
              } finally {
                setRemoving(false);
              }
            }}
          >
            {removing && <Loader2 className="animate-spin" />}
            Remove member
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CraftTitleInput({
  membershipId,
  initial,
}: {
  membershipId: Id<"memberships">;
  initial: string;
}) {
  const updateMember = useMutation(api.studios.updateMember);
  const [value, setValue] = useState(initial);
  return (
    <Input
      value={value}
      placeholder="e.g. Animation Supervisor"
      className="h-8 max-w-52 text-sm"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initial)
          void updateMember({ membershipId, craftTitle: value });
      }}
    />
  );
}

function InviteDialog({ studioId }: { studioId: Id<"studios"> }) {
  const invite = useMutation(api.studios.invite);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleKey>("artist");
  const [craftTitle, setCraftTitle] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" />}
      >
        <UserPlus className="size-4" /> {copy.actions.inviteMember}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Invite a member</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await invite({
                studioId,
                email,
                role: inviteRole,
                craftTitle: craftTitle || undefined,
              });
              toast.success(
                `Invited ${email} — they join automatically when they sign in with that email.`,
              );
              setOpen(false);
              setEmail("");
              setCraftTitle("");
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "Could not invite",
              );
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="anna@studio.com"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as RoleKey)}
              >
                <SelectTrigger className="w-full" aria-label="Role">
                  <SelectValue>
                    {ROLES.find((r) => r.key === inviteRole)?.label ??
                      inviteRole}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r.key !== "owner").map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-craft">Craft title (optional)</Label>
              <Input
                id="invite-craft"
                value={craftTitle}
                onChange={(e) => setCraftTitle(e.target.value)}
                placeholder="Colorist"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!email}>
              Invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
