"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Input,
  Label,
  Select,
  PageHero,
  StatusPill,
  useConfirm,
} from "@voicedesk/ui";
import {
  AlertTriangle,
  CheckCircle2,
  ListOrdered,
  PauseCircle,
  Phone,
  PhoneCall,
  PlayCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

interface NumberView {
  id: string;
  tenantId: string;
  e164: string;
  label: string | null;
  carrier: "twilio" | "telnyx";
  status: string;
  routed: boolean;
}

export interface PhoneNumbersResponse {
  numbers: NumberView[];
  tenants: Array<{ id: string; name: string }>;
  sipConfigured: boolean;
}

/** Register numbers bought in Twilio or Telnyx and route them to a business (Phase 2b, ADR 0013). */
export function PhoneNumbersPanel({ initial }: { initial: PhoneNumbersResponse }) {
  const t = useTranslations("phoneNumbers");
  const platform = useTranslations("platform");
  const common = useTranslations("common");
  const confirm = useConfirm();
  const [numbers, setNumbers] = useState(initial.numbers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tenantName = (id: string) => initial.tenants.find((x) => x.id === id)?.name ?? id;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      const created = await api<NumberView>("/api/platform/phone-numbers", {
        method: "POST",
        body: JSON.stringify({
          e164: formString(data, "e164"),
          tenantId: formString(data, "tenantId"),
          label: formString(data, "label") || undefined,
          carrier: formString(data, "carrier"),
        }),
      });
      setNumbers((list) => [...list, created].sort((a, b) => a.e164.localeCompare(b.e164)));
      form.reset();
    });
  }

  function update(id: string, patch: Partial<Pick<NumberView, "tenantId" | "status">>) {
    void run(async () => {
      const updated = await api<NumberView>(`/api/platform/phone-numbers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setNumbers((list) => list.map((n) => (n.id === id ? updated : n)));
    });
  }

  async function remove(id: string) {
    if (!(await confirm({ title: t("confirmRemove"), destructive: true }))) return;
    void run(async () => {
      await api(`/api/platform/phone-numbers/${id}`, { method: "DELETE" });
      setNumbers((list) => list.filter((n) => n.id !== id));
    });
  }

  return (
    <div className="stagger space-y-6">
      <PageHero
        icon={<PhoneCall />}
        eyebrow={platform("badge")}
        title={t("title")}
        description={t("subtitle")}
      />
      {!initial.sipConfigured ? <Alert tone="error">{t("notConfigured")}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardHead icon={<Plus />} title={t("addTitle")} hint={t("addHint")} />
        <form
          onSubmit={add}
          className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] lg:items-end [&>*]:min-w-0"
        >
          <div>
            <Label htmlFor="e164">{t("number")}</Label>
            <Input
              id="e164"
              name="e164"
              required
              placeholder="+44 20 7946 0000"
              className="tabular"
            />
          </div>
          <div>
            <Label htmlFor="tenantId">{t("business")}</Label>
            <Select id="tenantId" name="tenantId" required>
              {initial.tenants.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="carrier">{t("carrier")}</Label>
            <Select id="carrier" name="carrier">
              <option value="twilio">Twilio</option>
              <option value="telnyx">Telnyx</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="label">{t("label")}</Label>
            <Input id="label" name="label" maxLength={60} placeholder={t("labelPlaceholder")} />
          </div>
          <Button type="submit" disabled={busy || !initial.sipConfigured}>
            <Plus aria-hidden />
            {busy ? common("working") : t("add")}
          </Button>
        </form>
      </Card>

      <Card className="p-0">
        {numbers.length === 0 ? (
          <EmptyState icon={PhoneCall} title={t("empty")} />
        ) : (
          <ul className="divide-y divide-border" data-testid="phone-numbers">
            {numbers.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 text-sm"
              >
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    color: "var(--color-ch-voice)",
                    background: "color-mix(in srgb, var(--color-ch-voice) 14%, transparent)",
                  }}
                >
                  <Phone className="size-[18px]" />
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular font-display text-base font-semibold" dir="ltr">
                      {n.e164}
                    </span>
                    <Badge data-testid="number-carrier">
                      {n.carrier === "telnyx" ? "Telnyx" : "Twilio"}
                    </Badge>
                    {n.status === "active" ? (
                      n.routed ? (
                        <StatusPill tone="success" icon={CheckCircle2} label={t("routed")} />
                      ) : (
                        <StatusPill tone="warning" icon={AlertTriangle} label={t("notRouted")} />
                      )
                    ) : (
                      <StatusPill tone="neutral" icon={PauseCircle} label={t("disabled")} />
                    )}
                  </div>
                  {n.label ? (
                    <p className="mt-0.5 truncate text-muted-foreground" dir="auto">
                      {n.label}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={`tenant-${n.id}`} className="sr-only">
                    {t("business")}
                  </Label>
                  <Select
                    id={`tenant-${n.id}`}
                    className="h-9 w-48"
                    value={n.tenantId}
                    disabled={busy}
                    onChange={(e) => update(n.id, { tenantId: e.target.value })}
                    title={tenantName(n.tenantId)}
                  >
                    {initial.tenants.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      update(n.id, { status: n.status === "active" ? "disabled" : "active" })
                    }
                  >
                    {n.status === "active" ? (
                      <PauseCircle aria-hidden />
                    ) : (
                      <PlayCircle aria-hidden />
                    )}
                    {n.status === "active" ? t("disable") : t("enable")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    disabled={busy}
                    onClick={() => void remove(n.id)}
                  >
                    <Trash2 aria-hidden />
                    {t("remove")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHead
            icon={<ListOrdered />}
            title={t("twilioSetupTitle")}
            color="var(--color-secondary)"
          />
          <Steps
            items={[t("twilioSetup1"), t("twilioSetup2"), t("twilioSetup3"), t("setupLast")]}
          />
        </Card>
        <Card>
          <CardHead
            icon={<ListOrdered />}
            title={t("telnyxSetupTitle")}
            color="var(--color-accent)"
          />
          <Steps
            items={[t("telnyxSetup1"), t("telnyxSetup2"), t("telnyxSetup3"), t("setupLast")]}
          />
        </Card>
      </div>
    </div>
  );
}

/** Setup instructions as numbered steps with small number chips. */
function Steps(props: { items: string[] }) {
  return (
    <ol className="mt-4 space-y-3 text-sm">
      {props.items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span
            aria-hidden
            className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/12 text-xs font-semibold text-primary"
          >
            {i + 1}
          </span>
          <span className="pt-0.5 text-muted-foreground">{item}</span>
        </li>
      ))}
    </ol>
  );
}
