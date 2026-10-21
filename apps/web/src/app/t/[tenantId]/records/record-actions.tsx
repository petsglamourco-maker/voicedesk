"use client";

import { Badge, Button, Select } from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client-api";

const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

/** Ticket status: open → in progress → resolved / closed. */
export function TicketStatus(props: {
  tenantId: string;
  id: string;
  status: string;
  canEdit: boolean;
}) {
  const t = useTranslations("records");
  const [status, setStatus] = useState(props.status);
  const [busy, setBusy] = useState(false);
  if (!props.canEdit) return <Badge>{t(`ticketStatus.${status}` as "ticketStatus.open")}</Badge>;
  return (
    <Select
      aria-label={t("status")}
      className="h-8 w-36 text-xs"
      value={status}
      disabled={busy}
      onChange={async (e) => {
        const next = e.target.value;
        setBusy(true);
        try {
          await api(`/api/tenants/${props.tenantId}/tickets/${props.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: next }),
          });
          setStatus(next);
        } finally {
          setBusy(false);
        }
      }}
    >
      {TICKET_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t(`ticketStatus.${s}`)}
        </option>
      ))}
    </Select>
  );
}

/** Mark a message as dealt with. */
export function MessageDone(props: {
  tenantId: string;
  id: string;
  status: string;
  canEdit: boolean;
}) {
  const t = useTranslations("records");
  const [status, setStatus] = useState(props.status);
  const [busy, setBusy] = useState(false);
  if (status === "done") return <Badge tone="success">{t("done")}</Badge>;
  if (!props.canEdit) return <Badge>{t("new")}</Badge>;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/tenants/${props.tenantId}/messages/${props.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "done" }),
          });
          setStatus("done");
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("markDone")}
    </Button>
  );
}

/** Cancel a booking (calendar event removed, customer told). */
export function BookingCancel(props: {
  tenantId: string;
  id: string;
  status: string;
  canEdit: boolean;
}) {
  const t = useTranslations("records");
  const [status, setStatus] = useState(props.status);
  const [busy, setBusy] = useState(false);
  if (status !== "confirmed" || !props.canEdit) {
    return <Badge>{t(`bookingStatus.${status}` as "bookingStatus.confirmed")}</Badge>;
  }
  return (
    <span className="flex items-center gap-2">
      <Badge tone="success">{t("bookingStatus.confirmed")}</Badge>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(t("confirmCancel"))) return;
          setBusy(true);
          try {
            await api(`/api/tenants/${props.tenantId}/bookings/${props.id}/cancel`, {
              method: "POST",
            });
            setStatus("cancelled");
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("cancelBooking")}
      </Button>
    </span>
  );
}

/** Phase 6: the assistant phones the customer back (within calling hours; costs money). */
export function AiCallBack(props: {
  tenantId: string;
  sourceType: "ticket" | "message";
  id: string;
  canEdit: boolean;
}) {
  const t = useTranslations("records");
  const [state, setState] = useState<"idle" | "busy" | "planned" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  if (!props.canEdit) return null;
  if (state === "planned") return <Badge>{t("aiCallPlanned")}</Badge>;
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={state === "busy"}
        title={t("aiCallHint")}
        onClick={async () => {
          setState("busy");
          try {
            await api(`/api/tenants/${props.tenantId}/ai-calls`, {
              method: "POST",
              body: JSON.stringify({ sourceType: props.sourceType, sourceId: props.id }),
            });
            setState("planned");
          } catch (e) {
            setMessage(e instanceof Error ? e.message : null);
            setState("error");
          }
        }}
      >
        {t("aiCallBack")}
      </Button>
      {state === "error" && message ? <span className="text-xs text-danger">{message}</span> : null}
    </span>
  );
}
