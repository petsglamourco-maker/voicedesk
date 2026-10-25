"use client";

import {
  Alert,
  Button,
  Card,
  CardHead,
  Checkbox,
  Field,
  Input,
  Select,
  StatusPill,
  Switch,
  Textarea,
} from "@voicedesk/ui";
import { ChevronDown, ListOrdered, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { DepartmentInput, DepartmentsView } from "@/lib/api";
import { api } from "@/lib/client-api";

const ROUTINGS = ["people_then_phone", "people_only", "phone_only", "message_only"] as const;
const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const blank = (key: number): DepartmentInput => ({
  key,
  name: "",
  spokenNames: {},
  instructions: null,
  routing: "people_then_phone",
  transferPhone: null,
  notifyEmail: null,
  paymentLink: null,
  ringFirst: false,
  enabled: true,
  memberIds: [],
});

/** Departments and the phone menu (ADR 0025): keys, names, who deals with each one. */
export function DepartmentsEditor(props: { tenantId: string; initial: DepartmentsView }) {
  const t = useTranslations("departments");
  const common = useTranslations("common");
  const [view, setView] = useState(props.initial);
  const [items, setItems] = useState<DepartmentInput[]>(props.initial.departments);
  const [menu, setMenu] = useState({
    menuEnabled: props.initial.menuEnabled,
    menuHours: props.initial.menuHours,
    menuOnChat: props.initial.menuOnChat,
  });
  const [open, setOpen] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const canEdit = view.canEdit && view.planAllows;

  const update = (i: number, patch: Partial<DepartmentInput>) =>
    setItems((list) => list.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const freeKey = () => KEYS.find((k) => !items.some((d) => d.key === k)) ?? null;

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const next = await api<DepartmentsView>(`/api/tenants/${props.tenantId}/departments`, {
        method: "PUT",
        body: JSON.stringify({
          ...menu,
          departments: items.map((d) => ({
            ...d,
            name: d.name.trim(),
            instructions: d.instructions?.trim() || null,
            transferPhone: d.transferPhone?.trim() || null,
            notifyEmail: d.notifyEmail?.trim() || null,
            paymentLink: d.paymentLink?.trim() || null,
          })),
        }),
      });
      setView(next);
      setItems(next.departments);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {!view.planAllows ? (
        <Alert tone="info">
          {t("planNeeded")}{" "}
          <Link
            href={`/t/${props.tenantId}/billing`}
            className="font-semibold text-primary hover:underline"
          >
            {t("seePlans")}
          </Link>
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t("saved")}</Alert> : null}

      <Card>
        <CardHead icon={<ListOrdered />} title={t("menuTitle")} hint={t("menuHint")} />
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="flex items-start gap-3">
            <Switch
              className="mt-0.5"
              checked={menu.menuEnabled}
              disabled={!canEdit}
              aria-label={t("menuOn")}
              onCheckedChange={(on) => setMenu((m) => ({ ...m, menuEnabled: on }))}
            />
            <span>
              <span className="block text-sm font-semibold">{t("menuOn")}</span>
              <span className="block text-xs text-muted-foreground">{t("menuOnHint")}</span>
            </span>
          </label>
          <Field id="menu-hours" label={t("hoursLabel")}>
            <Select
              id="menu-hours"
              value={menu.menuHours}
              disabled={!canEdit}
              onChange={(e) =>
                setMenu((m) => ({ ...m, menuHours: e.target.value as "always" | "open" }))
              }
            >
              <option value="always">{t("hours.always")}</option>
              <option value="open">{t("hours.open")}</option>
            </Select>
          </Field>
          <label className="flex items-start gap-3">
            <Switch
              className="mt-0.5"
              checked={menu.menuOnChat}
              disabled={!canEdit}
              aria-label={t("chatOn")}
              onCheckedChange={(on) => setMenu((m) => ({ ...m, menuOnChat: on }))}
            />
            <span>
              <span className="block text-sm font-semibold">{t("chatOn")}</span>
              <span className="block text-xs text-muted-foreground">{t("chatOnHint")}</span>
            </span>
          </label>
        </div>
        {view.preview ? (
          <div
            className="mt-5 rounded-md border border-border bg-muted/40 p-3 text-sm"
            data-testid="menu-preview"
          >
            <span className="block text-xs font-semibold text-muted-foreground">
              {t("previewLabel")}
            </span>
            <span dir="auto">{view.preview}</span>
          </div>
        ) : null}
      </Card>

      <ul className="space-y-3" data-testid="department-list">
        {items.map((d, i) => (
          <li key={d.id ?? `new-${i}`}>
            <Card className="p-4">
              <div className="flex flex-wrap items-end gap-3">
                <Field id={`key-${i}`} label={t("key")} className="w-24">
                  <Select
                    id={`key-${i}`}
                    value={String(d.key)}
                    disabled={!canEdit}
                    onChange={(e) => update(i, { key: Number(e.target.value) })}
                  >
                    {KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`name-${i}`} label={t("name")} className="min-w-40 flex-1">
                  <Input
                    id={`name-${i}`}
                    value={d.name}
                    maxLength={40}
                    disabled={!canEdit}
                    placeholder={t("namePlaceholder")}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </Field>
                {!d.enabled ? <StatusPill tone="neutral" label={t("off")} /> : null}
                <Button
                  variant="ghost"
                  aria-expanded={open === i}
                  onClick={() => setOpen(open === i ? null : i)}
                >
                  {t("details")}
                  <ChevronDown className={open === i ? "rotate-180" : ""} aria-hidden />
                </Button>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("remove", { name: d.name || t("namePlaceholder") })}
                    onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
              {open === i ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    id={`instructions-${i}`}
                    label={t("instructions")}
                    hint={t("instructionsHint")}
                    className="sm:col-span-2"
                  >
                    <Textarea
                      id={`instructions-${i}`}
                      rows={3}
                      maxLength={1000}
                      disabled={!canEdit}
                      value={d.instructions ?? ""}
                      onChange={(e) => update(i, { instructions: e.target.value })}
                    />
                  </Field>
                  <Field id={`routing-${i}`} label={t("routing")}>
                    <Select
                      id={`routing-${i}`}
                      value={d.routing}
                      disabled={!canEdit}
                      onChange={(e) =>
                        update(i, { routing: e.target.value as DepartmentInput["routing"] })
                      }
                    >
                      {ROUTINGS.map((r) => (
                        <option key={r} value={r}>
                          {t(`routings.${r}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id={`phone-${i}`} label={t("transferPhone")} hint={t("transferPhoneHint")}>
                    <Input
                      id={`phone-${i}`}
                      type="tel"
                      disabled={!canEdit}
                      value={d.transferPhone ?? ""}
                      onChange={(e) => update(i, { transferPhone: e.target.value })}
                    />
                  </Field>
                  <Field id={`email-${i}`} label={t("notifyEmail")} hint={t("notifyEmailHint")}>
                    <Input
                      id={`email-${i}`}
                      type="email"
                      disabled={!canEdit}
                      value={d.notifyEmail ?? ""}
                      onChange={(e) => update(i, { notifyEmail: e.target.value })}
                    />
                  </Field>
                  <Field id={`pay-${i}`} label={t("paymentLink")} hint={t("paymentLinkHint")}>
                    <Input
                      id={`pay-${i}`}
                      type="url"
                      placeholder="https://"
                      disabled={!canEdit}
                      value={d.paymentLink ?? ""}
                      onChange={(e) => update(i, { paymentLink: e.target.value })}
                    />
                  </Field>
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-2 text-sm font-semibold">{t("people")}</legend>
                    <p className="mb-2 text-xs text-muted-foreground">{t("peopleHint")}</p>
                    <div className="flex flex-wrap gap-4">
                      {view.team.map((person) => (
                        <label key={person.userId} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            disabled={!canEdit}
                            checked={d.memberIds.includes(person.userId)}
                            onCheckedChange={(on) =>
                              update(i, {
                                memberIds: on
                                  ? [...d.memberIds, person.userId]
                                  : d.memberIds.filter((id) => id !== person.userId),
                              })
                            }
                          />
                          <span dir="auto">{person.name}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="flex items-start gap-3">
                    <Switch
                      className="mt-0.5"
                      checked={d.ringFirst}
                      disabled={!canEdit}
                      aria-label={t("ringFirst")}
                      onCheckedChange={(on) => update(i, { ringFirst: on })}
                    />
                    <span>
                      <span className="block text-sm font-semibold">{t("ringFirst")}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t("ringFirstHint")}
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3">
                    <Switch
                      className="mt-0.5"
                      checked={d.enabled}
                      disabled={!canEdit}
                      aria-label={t("enabled")}
                      onCheckedChange={(on) => update(i, { enabled: on })}
                    />
                    <span className="text-sm font-semibold">{t("enabled")}</span>
                  </label>
                </div>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={freeKey() === null}
            onClick={() => {
              const key = freeKey();
              if (key === null) return;
              setItems((list) => [...list, blank(key)]);
              setOpen(items.length);
            }}
          >
            <Plus aria-hidden />
            {t("add")}
          </Button>
          <Button disabled={pending} onClick={() => void save()}>
            {pending ? common("working") : t("save")}
          </Button>
        </div>
      ) : view.canEdit ? null : (
        <p className="text-sm text-muted-foreground">{t("ownersOnly")}</p>
      )}
      <p className="text-xs text-muted-foreground">{t("zeroNote")}</p>
    </div>
  );
}
