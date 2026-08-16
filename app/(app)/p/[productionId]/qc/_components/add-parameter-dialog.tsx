"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QC_CATEGORIES, showMutationError, type QcCategory } from "./qc-shared";

export function AddParameterDialog({ studioId }: { studioId: Id<"studios"> }) {
  const addParameter = useMutation(api.qc.addParameter);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<QcCategory>("video");
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [tolerance, setTolerance] = useState("");
  const [required, setRequired] = useState(true);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCategory("video");
    setName("");
    setSpec("");
    setTolerance("");
    setRequired(true);
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await addParameter({
        studioId,
        category,
        name: name.trim(),
        spec: spec.trim(),
        tolerance: tolerance.trim() || undefined,
        required,
      });
      setOpen(false);
      reset();
    } catch (e) {
      showMutationError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="size-3.5" /> Add check
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Add a QC check</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as QcCategory)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QC_CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-param-name">Name</Label>
              <Input
                id="qc-param-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Loudness (EBU R128)"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qc-param-spec">Spec</Label>
              <Input
                id="qc-param-spec"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder="-23 LUFS"
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-param-tolerance">Tolerance (optional)</Label>
              <Input
                id="qc-param-tolerance"
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
                placeholder="±0.5 LU"
                className="font-mono"
              />
            </div>
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={required}
              onCheckedChange={(checked) => setRequired(checked === true)}
            />
            Required — a fail here fails the run
          </Label>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || !spec.trim() || saving}>
              Add check
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
