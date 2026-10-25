"use client";

import { Avatar, Badge, Button, Card, CardHead, StatusPill, type StatusTone } from "@voicedesk/ui";
import {
  Ban,
  CalendarCheck,
  CalendarClock,
  CircleCheck,
  CircleX,
  PhoneCall,
  PhoneMissed,
  PhoneOutgoing,
  Voicemail,
  type LucideIcon,
} from "lucide-react";
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

const STATUS: Record<string, { tone: StatusTone; icon: LucideIcon; live?: boolean }> = {
  scheduled: { tone: "info", icon: CalendarClock },
  calling: { tone: "warning", icon: PhoneCall, live: true },
  answered: { tone: "success", icon: CircleCheck },
  voicemail: { tone: "secondary", icon: Voicemail },
  no_answer: { tone: "warning", icon: PhoneMissed },
  cancelled: { tone: "neutral", icon: Ban },
  failed: { tone: "danger", icon: CircleX },
};

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
    <Card>
      <CardHead
        icon={<PhoneOutgoing />}
        title={t("aiCallsTitle")}
        hint={t("aiCallsHint")}
        color="var(--color-ch-outbound)"
      />
      <ul className="mt-4 space-y-2 text-sm" data-testid="ai-calls">
        {calls.map((c) => {
          const status = STATUS[c.status] ?? { tone: "neutral" as const, icon: CalendarClock };
          return (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary/40"
            >
              <Avatar name={c.name ?? c.phone} size="sm" />
              <span className="font-medium" dir="auto">
                {c.name ?? c.phone}
              </span>
              <Badge tone={c.purpose === "confirmation" ? "primary" : "secondary"}>
                {c.purpose === "confirmation" ? (
                  <CalendarCheck aria-hidden />
                ) : (
                  <PhoneCall aria-hidden />
                )}
                {t(`aiPurpose.${c.purpose}` as "aiPurpose.callback")}
              </Badge>
              <span className="min-w-0 flex-1 basis-40 truncate text-muted-foreground" dir="auto">
                {c.reason}
              </span>
              <StatusPill
                tone={status.tone}
                icon={status.icon}
                live={status.live}
                className="tabular"
                label={
                  c.status === "scheduled"
                    ? t("aiDue", {
                        when: format.dateTime(new Date(c.notBefore), {
                          dateStyle: "short",
                          timeStyle: "short",
                        }),
                      })
                    : t(`aiStatus.${c.status}` as "aiStatus.answered")
                }
              />
              {c.conversationId && c.status !== "scheduled" ? (
                <Link
                  href={`/t/${props.tenantId}/calls/${c.conversationId}`}
                  className="text-xs font-semibold text-primary hover:underline"
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
          );
        })}
      </ul>
    </Card>
  );
}
