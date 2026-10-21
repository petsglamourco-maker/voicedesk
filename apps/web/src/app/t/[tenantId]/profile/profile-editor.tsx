"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  cn,
  Input,
  Label,
  Select,
  Textarea,
} from "@voicedesk/ui";
import {
  Building2,
  CalendarCheck,
  CheckCircle2,
  Clock,
  FilePen,
  MapPin,
  MessageCircleQuestion,
  Pencil,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScreenHero } from "@/components/screen-hero";
import { api } from "@/lib/client-api";

// Mirrors BusinessProfile in @voicedesk/agent-brain (validated by the API on save).
type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
interface Profile {
  businessName: string;
  summary: string;
  services: Array<{
    name: string;
    description: string | null;
    price: string | null;
    durationMinutes: number | null;
    bookable: boolean;
    sourceUrl: string | null;
  }>;
  openingHours: Array<{ day: Day; closed: boolean; open: string | null; close: string | null }>;
  hoursNotes: string | null;
  location: {
    address: string | null;
    area: string | null;
    directions: string | null;
    parking: string | null;
  };
  contact: { phone: string | null; email: string | null; website: string | null };
  policies: Array<{ topic: string; details: string; sourceUrl: string | null }>;
  faqs: Array<{ question: string; answer: string; sourceUrl: string | null }>;
  staff: Array<{ name: string; role: string | null }>;
  bookingRules: {
    minNoticeHours: number | null;
    bufferMinutes: number | null;
    cancellationPolicy: string | null;
  };
  sales: {
    primaryGoal: "booking" | "signup" | "both";
    whoWeServe: string | null;
    sellingPoints: string[];
    offers: Array<{ title: string; details: string; validUntil: string | null }>;
    newCustomerSteps: string | null;
    signupUrl: string | null;
  };
}

interface Version {
  version: number;
  data: Profile;
  generatedBy: string;
}

export interface ProfileResponse {
  approved: Version | null;
  draft: Version | null;
  template: Profile;
  aiAvailable: boolean;
}

const orNull = (v: string) => (v.trim() === "" ? null : v);
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function ProfileEditor(props: {
  tenantId: string;
  initial: ProfileResponse;
  canEdit: boolean;
}) {
  const t = useTranslations("profile");
  const common = useTranslations("common");
  const shell = useTranslations("shell");
  const base = `/api/tenants/${props.tenantId}/profile`;
  const [state, setState] = useState(props.initial);
  const [profile, setProfile] = useState<Profile>(
    props.initial.draft?.data ?? props.initial.approved?.data ?? props.initial.template,
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "approve" | "generate">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const waitingFor = useRef<number | null>(null);

  const update = (patch: Partial<Profile>) => {
    setProfile((p) => ({ ...p, ...patch }));
    setDirty(true);
  };

  // While a generation job runs, poll until a newer draft appears.
  useEffect(() => {
    if (busy !== "generate") return;
    const started = Date.now();
    const timer = setInterval(() => {
      void api<ProfileResponse>(base).then((next) => {
        const newest = next.draft?.version ?? 0;
        if (waitingFor.current !== null && newest > waitingFor.current) {
          setState(next);
          setProfile(next.draft!.data);
          setDirty(false);
          setBusy(null);
          setNotice(t("generated"));
        } else if (Date.now() - started > 240_000) {
          setBusy(null);
          setError(t("generateTimeout"));
        }
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [busy, base, t]);

  async function act(kind: "save" | "approve" | "generate") {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      if (kind === "generate") {
        waitingFor.current = Math.max(state.draft?.version ?? 0, state.approved?.version ?? 0);
        await api(`${base}/generate`, { method: "POST" });
        return; // polling effect finishes this
      }
      const { version } = await api<{ version: number }>(`${base}/draft`, {
        method: "PUT",
        body: JSON.stringify(profile),
      });
      if (kind === "approve") {
        await api(`${base}/approve`, { method: "POST", body: JSON.stringify({ version }) });
      }
      setState(await api<ProfileResponse>(base));
      setDirty(false);
      setNotice(kind === "approve" ? t("approvedNotice") : t("savedNotice"));
      setBusy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
      setBusy(null);
    }
  }

  const approved = state.approved?.data;
  const changed = (key: keyof Profile) =>
    approved !== undefined && JSON.stringify(approved[key]) !== JSON.stringify(profile[key]);
  const disabled = !props.canEdit || busy !== null;

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="profile"
        eyebrow={shell("groups.assistant")}
        title={t("title")}
        description={t("subtitle")}
        actions={
          props.canEdit ? (
            <>
              <Button
                variant="secondary"
                disabled={disabled || !state.aiAvailable}
                title={state.aiAvailable ? undefined : t("aiUnavailable")}
                onClick={() => void act("generate")}
              >
                {busy === "generate" ? t("generating") : t("generate")}
              </Button>
              <Button
                variant="secondary"
                disabled={disabled || !dirty}
                onClick={() => void act("save")}
              >
                {busy === "save" ? common("working") : t("saveDraft")}
              </Button>
              <Button
                disabled={disabled || (!dirty && !state.draft)}
                onClick={() => void act("approve")}
                data-testid="approve-profile"
              >
                {busy === "approve" ? common("working") : t("approve")}
              </Button>
            </>
          ) : undefined
        }
      >
        {state.approved ? (
          <Badge tone="success">
            <CheckCircle2 aria-hidden />
            {t("liveVersion", { version: state.approved.version })}
          </Badge>
        ) : (
          <Badge tone="danger">
            <TriangleAlert aria-hidden />
            {t("notLive")}
          </Badge>
        )}
        {state.draft ? (
          <Badge tone={state.draft.generatedBy === "ai" ? "accent" : "info"}>
            {state.draft.generatedBy === "ai" ? <Sparkles aria-hidden /> : <FilePen aria-hidden />}
            {t("draftVersion", { version: state.draft.version })}
            {state.draft.generatedBy === "ai" ? ` · ${t("aiGenerated")}` : ""}
          </Badge>
        ) : null}
        {dirty ? (
          <Badge tone="warning">
            <Pencil aria-hidden />
            {t("unsaved")}
          </Badge>
        ) : null}
      </ScreenHero>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!state.aiAvailable && props.canEdit ? <Alert>{t("aiUnavailable")}</Alert> : null}

      <Section
        icon={<Building2 />}
        color="var(--color-primary)"
        title={t("basics")}
        changed={changed("summary")}
        changedLabel={t("changed")}
        disabled={disabled}
      >
        <div>
          <Label htmlFor="businessName">{t("businessName")}</Label>
          <Input
            id="businessName"
            value={profile.businessName}
            onChange={(e) => update({ businessName: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="summary">{t("summary")}</Label>
          <Textarea
            id="summary"
            className="min-h-0"
            dir="auto"
            rows={3}
            value={profile.summary}
            onChange={(e) => update({ summary: e.target.value })}
          />
        </div>
      </Section>

      <Section
        icon={<Clock />}
        color="var(--color-info)"
        title={t("hours")}
        changed={changed("openingHours")}
        changedLabel={t("changed")}
        disabled={disabled}
      >
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {profile.openingHours.map((h, i) => {
            const set = (patch: Partial<Profile["openingHours"][number]>) =>
              update({
                openingHours: profile.openingHours.map((x, j) =>
                  j === i ? { ...x, ...patch } : x,
                ),
              });
            return (
              <div
                key={h.day}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[8rem_7rem_minmax(0,1fr)] sm:px-4",
                  h.closed && "bg-muted/40",
                )}
              >
                <span className="text-sm font-semibold">{t(`days.${h.day}`)}</span>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={h.closed}
                    onChange={(e) => set({ closed: e.target.checked })}
                  />
                  {t("closed")}
                </label>
                {!h.closed ? (
                  <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                    <Input
                      type="time"
                      aria-label={t("opensAt", { day: t(`days.${h.day}`) })}
                      className="tabular h-9 w-32"
                      value={h.open ?? ""}
                      onChange={(e) => set({ open: orNull(e.target.value) })}
                    />
                    <span aria-hidden className="text-muted-foreground">
                      –
                    </span>
                    <Input
                      type="time"
                      aria-label={t("closesAt", { day: t(`days.${h.day}`) })}
                      className="tabular h-9 w-32"
                      value={h.close ?? ""}
                      onChange={(e) => set({ close: orNull(e.target.value) })}
                    />
                  </div>
                ) : (
                  <span aria-hidden className="hidden text-muted-foreground sm:block">
                    —
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div>
          <Label htmlFor="hoursNotes">{t("hoursNotes")}</Label>
          <Input
            id="hoursNotes"
            value={profile.hoursNotes ?? ""}
            onChange={(e) => update({ hoursNotes: orNull(e.target.value) })}
          />
        </div>
      </Section>

      <Section
        icon={<Tags />}
        color="var(--color-accent)"
        title={t("services")}
        changed={changed("services")}
        changedLabel={t("changed")}
        disabled={disabled}
      >
        <ListEditor
          items={profile.services}
          onChange={(services) => update({ services })}
          addLabel={t("addService")}
          removeLabel={t("remove")}
          blank={{
            name: "",
            description: null,
            price: null,
            durationMinutes: null,
            bookable: true,
            sourceUrl: null,
          }}
          render={(s, set) => (
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] [&>*]:min-w-0">
              <Input
                aria-label={t("serviceName")}
                placeholder={t("serviceName")}
                value={s.name}
                onChange={(e) => set({ name: e.target.value })}
              />
              <Input
                aria-label={t("price")}
                placeholder={t("price")}
                value={s.price ?? ""}
                onChange={(e) => set({ price: orNull(e.target.value) })}
              />
              <Input
                aria-label={t("duration")}
                placeholder={t("duration")}
                type="number"
                className="tabular"
                min={0}
                value={s.durationMinutes ?? ""}
                onChange={(e) => set({ durationMinutes: numOrNull(e.target.value) })}
              />
              <label className="flex cursor-pointer items-center gap-2 px-1 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={s.bookable}
                  onChange={(e) => set({ bookable: e.target.checked })}
                />
                {t("bookable")}
              </label>
              <Input
                className="sm:col-span-4"
                aria-label={t("description")}
                placeholder={t("description")}
                value={s.description ?? ""}
                onChange={(e) => set({ description: orNull(e.target.value) })}
              />
            </div>
          )}
        />
      </Section>

      <Section
        icon={<MapPin />}
        color="var(--color-secondary)"
        title={t("locationContact")}
        changed={changed("location")}
        changedLabel={t("changed")}
        disabled={disabled}
      >
        <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          {(["address", "area", "directions", "parking"] as const).map((key) => (
            <div key={key}>
              <Label htmlFor={key}>{t(key)}</Label>
              <Input
                id={key}
                value={profile.location[key] ?? ""}
                onChange={(e) =>
                  update({ location: { ...profile.location, [key]: orNull(e.target.value) } })
                }
              />
            </div>
          ))}
          {(["phone", "email", "website"] as const).map((key) => (
            <div key={key}>
              <Label htmlFor={key}>{t(key)}</Label>
              <Input
                id={key}
                value={profile.contact[key] ?? ""}
                onChange={(e) =>
                  update({ contact: { ...profile.contact, [key]: orNull(e.target.value) } })
                }
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        icon={<TrendingUp />}
        color="var(--color-success)"
        title={t("sales")}
        hint={t("salesHint")}
        changed={changed("sales")}
        changedLabel={t("changed")}
        disabled={disabled}
      >
        <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div>
            <Label htmlFor="primaryGoal">{t("primaryGoal")}</Label>
            <Select
              id="primaryGoal"
              value={profile.sales.primaryGoal}
              onChange={(e) =>
                update({
                  sales: {
                    ...profile.sales,
                    primaryGoal: e.target.value as Profile["sales"]["primaryGoal"],
                  },
                })
              }
            >
              {(["booking", "signup", "both"] as const).map((g) => (
                <option key={g} value={g}>
                  {t(`goals.${g}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="signupUrl">{t("signupUrl")}</Label>
            <Input
              id="signupUrl"
              value={profile.sales.signupUrl ?? ""}
              onChange={(e) =>
                update({ sales: { ...profile.sales, signupUrl: orNull(e.target.value) } })
              }
            />
          </div>
        </div>
        <div>
          <Label htmlFor="whoWeServe">{t("whoWeServe")}</Label>
          <Textarea
            id="whoWeServe"
            className="min-h-0"
            dir="auto"
            rows={2}
            value={profile.sales.whoWeServe ?? ""}
            onChange={(e) =>
              update({ sales: { ...profile.sales, whoWeServe: orNull(e.target.value) } })
            }
          />
        </div>
        <div>
          <Label htmlFor="newCustomerSteps">{t("newCustomerSteps")}</Label>
          <Textarea
            id="newCustomerSteps"
            className="min-h-0"
            dir="auto"
            rows={3}
            value={profile.sales.newCustomerSteps ?? ""}
            onChange={(e) =>
              update({ sales: { ...profile.sales, newCustomerSteps: orNull(e.target.value) } })
            }
          />
        </div>
        <div>
          <Label>{t("sellingPoints")}</Label>
          <ListEditor
            items={profile.sales.sellingPoints.map((text) => ({ text }))}
            onChange={(items) =>
              update({ sales: { ...profile.sales, sellingPoints: items.map((i) => i.text) } })
            }
            addLabel={t("addSellingPoint")}
            removeLabel={t("remove")}
            blank={{ text: "" }}
            render={(item, set) => (
              <Input
                aria-label={t("sellingPoint")}
                placeholder={t("sellingPoint")}
                value={item.text}
                onChange={(e) => set({ text: e.target.value })}
              />
            )}
          />
        </div>
        <div>
          <Label>{t("offers")}</Label>
          <ListEditor
            items={profile.sales.offers}
            onChange={(offers) => update({ sales: { ...profile.sales, offers } })}
            addLabel={t("addOffer")}
            removeLabel={t("remove")}
            blank={{ title: "", details: "", validUntil: null }}
            render={(o, set) => (
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_2fr_1fr] [&>*]:min-w-0">
                <Input
                  aria-label={t("offerTitle")}
                  placeholder={t("offerTitle")}
                  value={o.title}
                  onChange={(e) => set({ title: e.target.value })}
                />
                <Input
                  aria-label={t("offerDetails")}
                  placeholder={t("offerDetails")}
                  value={o.details}
                  onChange={(e) => set({ details: e.target.value })}
                />
                <Input
                  aria-label={t("offerUntil")}
                  placeholder={t("offerUntil")}
                  value={o.validUntil ?? ""}
                  onChange={(e) => set({ validUntil: orNull(e.target.value) })}
                />
              </div>
            )}
          />
        </div>
      </Section>

      <Section
        icon={<CalendarCheck />}
        color="var(--color-warning)"
        title={t("bookingRules")}
        changed={changed("bookingRules")}
        changedLabel={t("changed")}
        disabled={disabled}
      >
        <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div>
            <Label htmlFor="minNotice">{t("minNotice")}</Label>
            <Input
              id="minNotice"
              type="number"
              className="tabular"
              min={0}
              value={profile.bookingRules.minNoticeHours ?? ""}
              onChange={(e) =>
                update({
                  bookingRules: {
                    ...profile.bookingRules,
                    minNoticeHours: numOrNull(e.target.value),
                  },
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="buffer">{t("buffer")}</Label>
            <Input
              id="buffer"
              type="number"
              className="tabular"
              min={0}
              max={240}
              step={5}
              aria-describedby="buffer-hint"
              value={profile.bookingRules.bufferMinutes ?? ""}
              onChange={(e) =>
                update({
                  bookingRules: {
                    ...profile.bookingRules,
                    bufferMinutes: numOrNull(e.target.value),
                  },
                })
              }
            />
            <p id="buffer-hint" className="mt-1 text-xs text-muted-foreground">
              {t("bufferHint")}
            </p>
          </div>
        </div>
        <div>
          <Label htmlFor="cancellation">{t("cancellation")}</Label>
          <Textarea
            id="cancellation"
            className="min-h-0"
            dir="auto"
            rows={2}
            value={profile.bookingRules.cancellationPolicy ?? ""}
            onChange={(e) =>
              update({
                bookingRules: {
                  ...profile.bookingRules,
                  cancellationPolicy: orNull(e.target.value),
                },
              })
            }
          />
        </div>
      </Section>

      <Section
        icon={<ShieldCheck />}
        color="var(--color-info)"
        title={t("policies")}
        changed={changed("policies")}
        changedLabel={t("changed")}
        disabled={disabled}
      >
        <ListEditor
          items={profile.policies}
          onChange={(policies) => update({ policies })}
          addLabel={t("addPolicy")}
          removeLabel={t("remove")}
          blank={{ topic: "", details: "", sourceUrl: null }}
          render={(p, set) => (
            <div className="grid min-w-0 flex-1 gap-2">
              <Input
                aria-label={t("topic")}
                placeholder={t("topic")}
                value={p.topic}
                onChange={(e) => set({ topic: e.target.value })}
              />
              <Textarea
                aria-label={t("details")}
                placeholder={t("details")}
                className="min-h-0"
                dir="auto"
                rows={2}
                value={p.details}
                onChange={(e) => set({ details: e.target.value })}
              />
            </div>
          )}
        />
      </Section>

      <Section
        icon={<MessageCircleQuestion />}
        color="var(--color-accent)"
        title={t("faqs")}
        hint={t("faqsHint")}
        changed={changed("faqs")}
        changedLabel={t("changed")}
        disabled={disabled}
      >
        <ListEditor
          items={profile.faqs}
          onChange={(faqs) => update({ faqs })}
          addLabel={t("addFaq")}
          removeLabel={t("remove")}
          blank={{ question: "", answer: "", sourceUrl: null }}
          render={(f, set) => (
            <div className="grid min-w-0 flex-1 gap-2">
              <Input
                aria-label={t("question")}
                placeholder={t("question")}
                value={f.question}
                onChange={(e) => set({ question: e.target.value })}
              />
              <Textarea
                aria-label={t("answer")}
                placeholder={t("answer")}
                className="min-h-0"
                dir="auto"
                rows={2}
                value={f.answer}
                onChange={(e) => set({ answer: e.target.value })}
              />
            </div>
          )}
        />
      </Section>

      <Section
        icon={<Users />}
        color="var(--color-secondary)"
        title={t("staff")}
        changed={changed("staff")}
        changedLabel={t("changed")}
        disabled={disabled}
      >
        <ListEditor
          items={profile.staff}
          onChange={(staff) => update({ staff })}
          addLabel={t("addStaff")}
          removeLabel={t("remove")}
          blank={{ name: "", role: null }}
          render={(s, set) => (
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 [&>*]:min-w-0">
              <Input
                aria-label={t("staffName")}
                placeholder={t("staffName")}
                value={s.name}
                onChange={(e) => set({ name: e.target.value })}
              />
              <Input
                aria-label={t("staffRole")}
                placeholder={t("staffRole")}
                value={s.role ?? ""}
                onChange={(e) => set({ role: orNull(e.target.value) })}
              />
            </div>
          )}
        />
      </Section>
    </div>
  );
}

function Section(props: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  color?: string;
  changed: boolean;
  changedLabel: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHead
        icon={props.icon}
        color={props.color}
        title={props.title}
        hint={props.hint}
        aside={
          props.changed ? (
            <Badge tone="primary">
              <Pencil aria-hidden />
              {props.changedLabel}
            </Badge>
          ) : null
        }
      />
      <fieldset disabled={props.disabled} className="mt-5 min-w-0 space-y-4">
        {props.children}
      </fieldset>
    </Card>
  );
}

function ListEditor<T>(props: {
  items: T[];
  onChange: (items: T[]) => void;
  blank: T;
  addLabel: string;
  removeLabel: string;
  render: (item: T, set: (patch: Partial<T>) => void) => ReactNode;
}) {
  return (
    <div className="space-y-3">
      {props.items.map((item, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_45%,transparent)] p-3 sm:flex-row sm:items-start"
        >
          {props.render(item, (patch) =>
            props.onChange(props.items.map((x, j) => (j === i ? { ...x, ...patch } : x))),
          )}
          <Button
            variant="ghost"
            size="sm"
            className="self-end text-danger sm:self-auto"
            onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}
          >
            <Trash2 aria-hidden />
            {props.removeLabel}
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        shape="pill"
        onClick={() => props.onChange([...props.items, props.blank])}
      >
        + {props.addLabel}
      </Button>
    </div>
  );
}
