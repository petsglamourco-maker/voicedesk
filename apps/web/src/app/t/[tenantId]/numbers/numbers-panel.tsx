"use client";

import {
  Alert,
  Button,
  Card,
  CardHead,
  Input,
  Label,
  Select,
  StatusPill,
  buttonVariants,
  useConfirm,
  type StatusTone,
} from "@voicedesk/ui";
import { BadgeCheck, Hash, Phone, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";

export interface NumbersView {
  country: string;
  currency: string;
  paidPlan: boolean;
  available: boolean;
  allowance: { included: number; extra: number; total: number; used: number };
  prices: { local: number; mobile: number };
  numbers: Array<{
    id: string;
    e164: string;
    label: string | null;
    status: string;
    billing: string;
    numberType: string | null;
    releaseAt: string | null;
  }>;
  identities: Array<{ numberType: string; status: string; reason: string | null }>;
  orders: Array<{
    id: string;
    numberType: string;
    kind: string;
    e164: string;
    status: string;
    reason: string | null;
  }>;
}

type NumberType = "local" | "mobile";

const ORDER_TONE: Record<string, StatusTone> = {
  waiting_review: "info",
  buying: "info",
  active: "success",
  failed: "danger",
  cancelled: "neutral",
};

/** Getting numbers on a paid plan (ADR 0032): review once, pick, and it's bought for you. */
export function NumbersPanel(props: {
  tenantId: string;
  view: NumbersView;
  canManage: boolean;
  businessName: string;
}) {
  const t = useTranslations("numbers");
  const common = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const confirm = useConfirm();
  const { view } = props;
  const [type, setType] = useState<NumberType>("local");
  const [area, setArea] = useState("");
  const [results, setResults] = useState<Array<{ e164: string; locality: string | null }>>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/tenants/${props.tenantId}/numbers`;
  const identity = view.identities.find((i) => i.numberType === type);
  const pendingIncluded = view.orders.filter(
    (o) => o.kind === "included" && (o.status === "waiting_review" || o.status === "buying"),
  ).length;
  const includedUsed =
    view.numbers.filter((n) => n.billing !== "extra" && n.status === "active").length +
    pendingIncluded;
  const kind = includedUsed < view.allowance.included ? "included" : "extra";
  const price = (minor: number) =>
    format.number(minor / 100, { style: "currency", currency: view.currency });

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = f.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    await run(() =>
      api(`${base}/identity`, {
        method: "POST",
        body: JSON.stringify({
          type,
          businessName: text("businessName"),
          registrationNumber: text("registrationNumber"),
          website: text("website"),
          contactFirstName: text("firstName"),
          contactLastName: text("lastName"),
          contactEmail: text("email"),
          contactPhone: text("phone"),
          address: {
            street: text("street"),
            city: text("city"),
            region: text("region"),
            postalCode: text("postalCode"),
          },
        }),
      }),
    );
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const found = await api<{ numbers: Array<{ e164: string; locality: string | null }> }>(
        `${base}/search?type=${type}&area=${encodeURIComponent(area)}`,
      );
      setResults(found.numbers);
      setPick(found.numbers[0]?.e164 ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function order() {
    if (!pick) return;
    if (
      kind === "extra" &&
      !(await confirm({
        title: t("extraConfirmTitle"),
        description: t("extraConfirm", { price: price(view.prices[type]) }),
        confirmLabel: t("addExtra"),
      }))
    ) {
      return;
    }
    await run(async () => {
      await api(`${base}/orders`, {
        method: "POST",
        body: JSON.stringify({ type, e164: pick, area: area || undefined, kind }),
      });
      setResults([]);
      setPick(null);
    });
  }

  async function release(id: string, e164: string) {
    if (
      !(await confirm({
        title: t("releaseTitle"),
        description: t("releaseConfirm", { number: e164 }),
        confirmLabel: t("release"),
        destructive: true,
      }))
    ) {
      return;
    }
    await run(() => api(`${base}/${id}`, { method: "DELETE" }));
  }

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!view.paidPlan ? (
        <Alert tone="info">
          {t("paidOnly")}{" "}
          <Link
            href={`/t/${props.tenantId}/billing`}
            className="font-semibold text-primary hover:underline"
          >
            {t("seePlans")}
          </Link>
        </Alert>
      ) : !view.available ? (
        <Alert tone="info">{t("notSetUp")}</Alert>
      ) : null}

      <Card>
        <CardHead
          icon={<Phone />}
          title={t("yours")}
          hint={t("allowance", {
            used: view.allowance.used,
            included: view.allowance.included,
            extra: view.allowance.extra,
          })}
        />
        {view.numbers.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-border" data-testid="number-list">
            {view.numbers.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="tabular font-display text-lg font-semibold">{n.e164}</span>
                {n.label ? <span className="text-sm text-muted-foreground">{n.label}</span> : null}
                <StatusPill
                  tone={n.status === "active" ? "success" : "warning"}
                  label={n.status === "active" ? t(`billing.${n.billing}`) : t("off")}
                />
                {n.releaseAt ? (
                  <span className="text-xs text-warning">
                    {t("releasesOn", {
                      date: format.dateTime(new Date(n.releaseAt), { dateStyle: "medium" }),
                    })}
                  </span>
                ) : null}
                {props.canManage && n.billing !== "manual" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ms-auto"
                    disabled={busy}
                    onClick={() => void release(n.id, n.e164)}
                  >
                    {t("release")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {view.orders.some((o) => o.status !== "active") ? (
          <ul className="mt-4 space-y-2 text-sm">
            {view.orders
              .filter((o) => o.status !== "active")
              .map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3">
                  <span className="tabular">{o.e164}</span>
                  <StatusPill
                    tone={ORDER_TONE[o.status] ?? "neutral"}
                    label={t(`order.${o.status}`)}
                  />
                  {o.reason ? (
                    <span className="text-xs text-muted-foreground">
                      {t.has(`reason.${o.reason}`) ? t(`reason.${o.reason}`) : o.reason}
                    </span>
                  ) : null}
                  {props.canManage && o.status === "waiting_review" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() => api(`${base}/orders/${o.id}`, { method: "DELETE" }))
                      }
                    >
                      {t("cancel")}
                    </Button>
                  ) : null}
                </li>
              ))}
          </ul>
        ) : null}
      </Card>

      {view.paidPlan && view.available && props.canManage ? (
        <Card>
          <CardHead icon={<Hash />} title={t("get")} hint={t("getHint")} />
          <div className="mt-4 max-w-xs">
            <Label htmlFor="numberType">{t("type")}</Label>
            <Select
              id="numberType"
              value={type}
              onChange={(e) => {
                setType(e.target.value as NumberType);
                setResults([]);
              }}
            >
              <option value="local">{t("typeLocal")}</option>
              <option value="mobile">{t("typeMobile")}</option>
            </Select>
          </div>

          {!identity || identity.status === "rejected" ? (
            <form
              method="post"
              onSubmit={(e) => void submitDetails(e)}
              className="mt-5 space-y-4"
              data-testid="identity-form"
            >
              <Alert tone={identity?.status === "rejected" ? "error" : "info"}>
                <ShieldCheck aria-hidden className="me-1 inline size-4" />
                {identity?.status === "rejected"
                  ? t("rejected", { reason: identity.reason ?? "" })
                  : t("whyDetails")}
              </Alert>
              <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                <Field
                  name="businessName"
                  label={t("f.businessName")}
                  defaultValue={props.businessName}
                />
                <Field name="registrationNumber" label={t("f.registrationNumber")} />
                <Field name="website" label={t("f.website")} type="url" placeholder="https://" />
                <Field name="phone" label={t("f.phone")} placeholder="+447700900123" />
                <Field name="firstName" label={t("f.firstName")} />
                <Field name="lastName" label={t("f.lastName")} />
                <Field name="email" label={t("f.email")} type="email" />
                <Field name="street" label={t("f.street")} />
                <Field name="city" label={t("f.city")} />
                <Field name="region" label={t("f.region")} required={false} />
                <Field name="postalCode" label={t("f.postalCode")} />
              </div>
              <Button type="submit" disabled={busy}>
                <BadgeCheck aria-hidden />
                {t("sendDetails")}
              </Button>
            </form>
          ) : (
            <div className="mt-5 space-y-4">
              <p className="text-sm">
                {identity.status === "approved" ? t("approved") : t("pending")}
              </p>
              <form
                method="post"
                onSubmit={(e) => void search(e)}
                className="flex flex-wrap items-end gap-3"
              >
                <div>
                  <Label htmlFor="area">{t("area")}</Label>
                  <Input
                    id="area"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    placeholder={t("areaPlaceholder")}
                    className="h-11"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={busy} className="h-11">
                  <Search aria-hidden />
                  {t("search")}
                </Button>
              </form>
              {results.length ? (
                <fieldset className="space-y-2" data-testid="number-results">
                  <legend className="mb-1 text-sm font-medium">{t("choose")}</legend>
                  {results.map((n) => (
                    <label key={n.e164} className="flex items-center gap-3 text-sm">
                      <input
                        type="radio"
                        name="pick"
                        className="size-4 accent-primary"
                        checked={pick === n.e164}
                        onChange={() => setPick(n.e164)}
                      />
                      <span className="tabular font-medium">{n.e164}</span>
                      {n.locality ? (
                        <span className="text-muted-foreground">{n.locality}</span>
                      ) : null}
                    </label>
                  ))}
                  <p className="pt-2 text-sm text-muted-foreground">
                    {kind === "included"
                      ? t("includedNote")
                      : t("extraNote", { price: price(view.prices[type]) })}
                  </p>
                  <Button disabled={busy || !pick} onClick={() => void order()}>
                    {kind === "included" ? t("getThis") : t("addExtra")}
                  </Button>
                </fieldset>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {t("prices", { local: price(view.prices.local), mobile: price(view.prices.mobile) })}{" "}
        <Link
          href={`/t/${props.tenantId}/billing`}
          className={buttonVariants({ variant: "link", size: "sm" })}
        >
          {t("seePlans")}
        </Link>
      </p>
    </div>
  );
}

function Field(props: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        defaultValue={props.defaultValue}
        required={props.required ?? true}
        className="h-11"
      />
    </div>
  );
}
