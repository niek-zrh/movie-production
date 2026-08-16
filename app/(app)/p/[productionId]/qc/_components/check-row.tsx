"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/app/user-avatar";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { showMutationError } from "./qc-shared";

type RunDetail = NonNullable<(typeof api.qc.getRun)["_returnType"]>;
export type RunCheck = RunDetail["checks"][number];
type CheckResult = RunCheck["result"];

const RESULT_ACTIVE: Record<"pass" | "fail" | "na", string> = {
  pass: "bg-status-approved text-white",
  fail: "bg-destructive text-white",
  na: "bg-muted-foreground text-background",
};

const RESULT_LABEL: Record<"pass" | "fail" | "na", string> = {
  pass: "Pass",
  fail: "Fail",
  na: "N/A",
};

/**
 * One checklist row: parameter + spec, three-state Pass/Fail/N-A (click the
 * active state again to reset to pending), measured value saved on blur, a
 * note field once it fails, and who checked it.
 */
export function CheckRow({
  check,
  canRun,
}: {
  check: RunCheck;
  canRun: boolean;
}) {
  const setCheck = useMutation(api.qc.setCheck);
  const [measured, setMeasured] = useState(check.measured ?? "");
  const [note, setNote] = useState(check.note ?? "");
  const parameter = check.parameter;

  const save = async (result: CheckResult) => {
    try {
      await setCheck({
        checkId: check._id,
        result,
        measured: measured.trim() || undefined,
        note: note.trim() || undefined,
      });
    } catch (e) {
      showMutationError(e);
    }
  };

  const toggle = (result: "pass" | "fail" | "na") =>
    void save(check.result === result ? "pending" : result);

  const buttonClasses = (result: "pass" | "fail" | "na") =>
    cn(
      "h-6 px-2 text-[11px] font-medium transition-colors",
      check.result === result
        ? RESULT_ACTIVE[result]
        : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-52">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">
              {parameter.name}
            </span>
            {parameter.required && (
              <span
                className="size-1 shrink-0 rounded-full bg-foreground/35"
                title="Required"
              />
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
            <span className="font-mono">{parameter.spec}</span>
            {parameter.tolerance && (
              <span className="text-muted-foreground">
                · {parameter.tolerance}
              </span>
            )}
          </div>
        </div>

        {check.checkedByUser && check.checkedAt !== undefined && (
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <UserAvatar
              name={check.checkedByUser.name}
              image={check.checkedByUser.image}
              className="size-4 text-[8px]"
            />
            <span>{formatWhen(check.checkedAt)}</span>
          </div>
        )}

        {canRun ? (
          <Input
            value={measured}
            onChange={(e) => setMeasured(e.target.value)}
            placeholder={parameter.spec}
            className="h-7 w-40 shrink-0 font-mono text-xs md:text-xs"
            aria-label={`Measured value for ${parameter.name}`}
            onBlur={() => {
              if ((measured.trim() || undefined) !== check.measured)
                void save(check.result);
            }}
          />
        ) : (
          check.measured && (
            <span className="shrink-0 font-mono text-xs">{check.measured}</span>
          )
        )}

        {canRun ? (
          <div className="inline-flex shrink-0 divide-x overflow-hidden rounded-md border">
            {(["pass", "fail", "na"] as const).map((result) =>
              result === "na" && parameter.required ? (
                <Tooltip key={result}>
                  <TooltipTrigger
                    className={buttonClasses(result)}
                    onClick={() => toggle(result)}
                  >
                    {RESULT_LABEL[result]}
                  </TooltipTrigger>
                  <TooltipContent>
                    Required — N/A keeps the run open
                  </TooltipContent>
                </Tooltip>
              ) : (
                <button
                  key={result}
                  type="button"
                  className={buttonClasses(result)}
                  onClick={() => toggle(result)}
                >
                  {RESULT_LABEL[result]}
                </button>
              ),
            )}
          </div>
        ) : (
          <span
            className={cn(
              "shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium",
              check.result === "pending"
                ? "text-muted-foreground"
                : RESULT_ACTIVE[check.result],
            )}
          >
            {check.result === "pending" ? "Pending" : RESULT_LABEL[check.result]}
          </span>
        )}
      </div>

      {canRun
        ? (check.result === "fail" || note.trim() !== "") && (
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What failed?"
              className="mt-2 h-7 text-xs md:text-xs"
              aria-label={`Failure note for ${parameter.name}`}
              onBlur={() => {
                if ((note.trim() || undefined) !== check.note)
                  void save(check.result);
              }}
            />
          )
        : check.note && (
            <p className="mt-1.5 text-xs text-destructive">{check.note}</p>
          )}
    </li>
  );
}
