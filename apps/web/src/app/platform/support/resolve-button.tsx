"use client";

import { Button } from "@voicedesk/ui";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";

/** Marks a support request resolved (or open again), then refreshes the list. */
export function ResolveButton(props: {
  id: string;
  status: "open" | "resolved";
  labels: { resolve: string; reopen: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = props.status === "open" ? "resolved" : "open";
  return (
    <Button
      size="sm"
      variant={next === "resolved" ? "primary" : "ghost"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/platform/support-requests/${props.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: next }),
          });
          router.refresh();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {next === "resolved" ? <CheckCircle2 aria-hidden /> : <RotateCcw aria-hidden />}
      {next === "resolved" ? props.labels.resolve : props.labels.reopen}
    </Button>
  );
}
