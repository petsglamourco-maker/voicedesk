"use client";

import { Badge, Button, Card, CardDescription, CardTitle } from "@voicedesk/ui";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

interface AiCall {
  id: string;
  purpose: string;
  status: string;
  outcome: string | null;
  reason: string | null;
  name: string | null;
  phone: string;
  notBefore: string;
  attempts: number;
  conversationId: string | null;
}

/** Calls the assistant will make (callbacks, confirmations) and how recent ones went. */
export function AiCalls(props: { tenantId: string; canEdit: boolean }) {
  const t = useTranslations("calls");
  const format = useFormatter();
  const [calls, setCalls] = useState<AiCall[] | null>(null);
  const base = `/api/tenants/${props.tenantId}/ai-calls`;

  useEffect(() => {
    let cancelled = false;
    api<{ calls: AiCall[] }>(base)
      .then((res) => {
        if (!cancelled) setCalls(res.calls);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (!calls || calls.length === 0) return null;
  return (
    <Card className="p-0">
      <div className="px-4 pt-4">
        <CardTitle className="text-base">{t("aiCallsTitle")}</CardTitle>
        <CardDescription>{t("aiCallsHint")}</CardDescription>
      </div>
      <ul className="mt-2 divide-y divide-border text-sm" data-testid="ai-calls">
        {calls.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
            <Badge>{t(`aiPurpose.${c.purpose}` as "aiPurpose.callback")}</Badge>
            <span className="font-medium" dir="auto">
              {c.name ?? c.phone}
            </span>
            <span className="flex-1 truncate text-muted-foreground" dir="auto">
              {c.reason}
            </span>
            <span className="text-xs text-muted-foreground">
              {c.status === "scheduled"
                ? t("aiDue", {
                    when: format.dateTime(new Date(c.notBefore), {
                      dateStyle: "short",
                      timeStyle: "short",
                    }),
                  })
                : t(`aiStatus.${c.status}` as "aiStatus.answered")}
            </span>
            {c.conversationId && c.status !== "scheduled" ? (
              <Link
                href={`/t/${props.tenantId}/calls/${c.conversationId}`}
                className="text-xs text-primary hover:underline"
              >
                {t("open")}
              </Link>
            ) : null}
            {c.status === "scheduled" && props.canEdit ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await api(`${base}/${c.id}`, { method: "DELETE" });
                  setCalls((list) =>
                    (list ?? []).map((x) => (x.id === c.id ? { ...x, status: "cancelled" } : x)),
                  );
                }}
              >
                {t("aiCancel")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
