"use client";

import { Button, Input, Label } from "@voicedesk/ui";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";

/** The /try switch and the daily limit (needs the password confirmed, like every platform change). */
export function DemoSettingsForm(props: {
  initial: { enabled: boolean; dailyLimit: number };
  labels: { enabled: string; dailyLimit: string; save: string; saved: string };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(props.initial.enabled);
  const [dailyLimit, setDailyLimit] = useState(props.initial.dailyLimit);
  const [busy, setBusy] = useState(false);
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/api/platform/demos", {
            method: "PUT",
            body: JSON.stringify({ enabled, dailyLimit }),
          });
          toast.success(props.labels.saved);
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flex items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {props.labels.enabled}
      </label>
      <div className="max-w-xs">
        <Label htmlFor="dailyLimit">{props.labels.dailyLimit}</Label>
        <Input
          id="dailyLimit"
          type="number"
          className="tabular"
          min={1}
          max={200}
          value={dailyLimit}
          onChange={(e) => setDailyLimit(Number(e.target.value) || 1)}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {props.labels.save}
      </Button>
    </form>
  );
}

/** Forgets a lead's email (on their request). */
export function ForgetLeadButton(props: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/platform/demos/${props.id}/email`, { method: "DELETE" });
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 aria-hidden />
      {props.label}
    </Button>
  );
}
