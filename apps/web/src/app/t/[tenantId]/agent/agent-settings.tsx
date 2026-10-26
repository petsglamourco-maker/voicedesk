"use client";

import { Alert, Avatar, Button, Card, CardHead, cn, Input, Label, Select } from "@voicedesk/ui";
import {
  Bell,
  CheckCircle2,
  Keyboard,
  Languages,
  Mic,
  Newspaper,
  PhoneForwarded,
  MessageSquareReply,
  PhoneOutgoing,
  Play,
  Smile,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/client-api";
import { LOCALES } from "@/i18n/locales";
import { ScreenHero } from "@/components/screen-hero";

/** A setting that's on or off: a bordered row whose whole surface toggles the checkbox. */
function ToggleRow(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3 text-sm transition-[border-color,background-color] duration-200 hover:border-input has-[:checked]:border-primary/50 has-[:checked]:bg-primary/8 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block font-medium">{props.label}</span>
        {props.hint ? (
          <span className="mt-0.5 block text-muted-foreground">{props.hint}</span>
        ) : null}
      </span>
    </label>
  );
}

interface Settings {
  personaId: string;
  personaNames: Record<string, string>;
  enabledLanguages: string[];
  adminLanguage: string;
  recordCalls: boolean;
  reminderHours: number;
  customerConfirmations: boolean;
  alertPhone: string | null;
  voiceIds: Record<string, string>;
  transferPhone: string | null;
  transferHours: string;
  onCallPhone: string | null;
  urgentSituations: string | null;
  handoffRoute: string;
  ringSeconds: number;
  callEntry: string;
  ringFirst: boolean;
  followUps: boolean;
  feedbackEnabled: boolean;
  feedbackAfterCalls: boolean;
  npsEvery: number;
  dailyBrief: boolean;
  aiCallbacks: boolean;
  confirmationCalls: boolean;
  outboundDailyCap: number;
  voiceTyping: boolean;
  reviewRequests: boolean;
  reviewLink: string | null;
  valueReport: boolean;
  averageBookingPence: number | null;
}

export interface AgentResponse {
  settings: Settings;
  personas: Array<{
    id: string;
    defaultName: string;
    gender: string;
    style: string;
    bestFor: string;
  }>;
}

export function AgentSettingsForm(props: {
  tenantId: string;
  initial: AgentResponse;
  canEdit: boolean;
}) {
  const t = useTranslations("agent");
  const shell = useTranslations("shell");
  const tv = useTranslations("voice");
  const tn = useTranslations("notifications");
  const tt = useTranslations("transfers");
  const tf = useTranslations("feedbackSettings");
  const tb = useTranslations("dailyBrief");
  const to = useTranslations("aiCalls");
  const tfu = useTranslations("followUps");
  const tw = useTranslations("voiceTyping");
  const languages = useTranslations("languages");
  const common = useTranslations("common");
  const [settings, setSettings] = useState(props.initial.settings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewLanguage, setPreviewLanguage] = useState(
    props.initial.settings.enabledLanguages[0] ?? "en",
  );

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSaved(false);
  };

  async function preview(personaId: string) {
    setPreviewing(personaId);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${props.tenantId}/agent/voice-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personaId, language: previewLanguage }),
      });
      if (res.status === 503) throw new Error(tv("previewUnavailable"));
      if (!res.ok) throw new Error(common("errorGeneric"));
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPreviewing(null);
    }
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api(`/api/tenants/${props.tenantId}/agent`, {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="agent"
        eyebrow={shell("groups.assistant")}
        title={t("title")}
        description={t("subtitle")}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t("saved")}</Alert> : null}

      <fieldset disabled={!props.canEdit || pending} className="space-y-6">
        <Card>
          <CardHead
            icon={<UserRound />}
            title={t("persona")}
            hint={t("personaHint")}
            className="flex-wrap"
            aside={
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor="previewLanguage" className="mb-0 text-sm whitespace-nowrap">
                  {tv("preview")}:
                </Label>
                <Select
                  id="previewLanguage"
                  className="h-9 w-36"
                  value={previewLanguage}
                  onChange={(e) => setPreviewLanguage(e.target.value)}
                >
                  {LOCALES.map((code) => (
                    <option key={code} value={code}>
                      {languages(code)}
                    </option>
                  ))}
                </Select>
              </div>
            }
          />
          <div
            role="radiogroup"
            aria-label={t("persona")}
            className="mt-5 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0"
          >
            {props.initial.personas.map((p) => {
              const selected = settings.personaId === p.id;
              const name = settings.personaNames[p.id] || p.defaultName;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "glass relative rounded-xl p-4 transition-[box-shadow,border-color] duration-300 ease-[var(--ease-spring)] has-[input[type=radio]:focus-visible]:outline-2 has-[input[type=radio]:focus-visible]:outline-offset-2 has-[input[type=radio]:focus-visible]:outline-ring",
                    selected
                      ? "border-primary/60 shadow-[0_0_24px_-6px_var(--color-glow)] ring-2 ring-primary"
                      : "hover:border-input",
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="persona"
                      className="sr-only"
                      checked={selected}
                      onChange={() => update({ personaId: p.id })}
                    />
                    <Avatar name={name} size="lg" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-display text-base font-semibold" dir="auto">
                          {name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({t(`gender.${p.gender}`)})
                        </span>
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{p.style}</span>
                      <span className="mt-1 block text-xs">{t("bestFor", { use: p.bestFor })}</span>
                    </span>
                    <CheckCircle2
                      aria-hidden
                      className={cn(
                        "size-5 shrink-0 text-primary transition-[opacity,transform] duration-300 ease-[var(--ease-spring)]",
                        selected ? "scale-100 opacity-100" : "scale-75 opacity-0",
                      )}
                    />
                  </label>
                  <div className="mt-4 border-t border-border pt-3">
                    <Label htmlFor={`name-${p.id}`} className="text-xs">
                      {t("rename")}
                    </Label>
                    <Input
                      id={`name-${p.id}`}
                      className="h-9"
                      placeholder={p.defaultName}
                      maxLength={40}
                      dir="auto"
                      value={settings.personaNames[p.id] ?? ""}
                      onChange={(e) => {
                        const names = { ...settings.personaNames, [p.id]: e.target.value };
                        if (!e.target.value.trim()) delete names[p.id];
                        update({ personaNames: names });
                      }}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    shape="pill"
                    className="mt-3"
                    onClick={() => void preview(p.id)}
                    disabled={previewing !== null}
                  >
                    {previewing === p.id ? (
                      <span
                        className="size-2 animate-glow-pulse rounded-full bg-primary"
                        aria-hidden
                      />
                    ) : (
                      <Play aria-hidden />
                    )}
                    {previewing === p.id ? common("working") : tv("preview")}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHead
            icon={<Languages />}
            title={t("languages")}
            hint={t("languagesHint")}
            color="var(--color-secondary)"
          />
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 [&>*]:min-w-0">
            {LOCALES.map((code) => (
              <label
                key={code}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium transition-[border-color,background-color] duration-200 hover:border-input has-[:checked]:border-secondary/50 has-[:checked]:bg-secondary/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-secondary focus-visible:outline-none"
                  checked={settings.enabledLanguages.includes(code)}
                  onChange={(e) =>
                    update({
                      enabledLanguages: e.target.checked
                        ? [...settings.enabledLanguages, code]
                        : settings.enabledLanguages.filter((l) => l !== code),
                    })
                  }
                />
                <span className="truncate">{languages(code)}</span>
              </label>
            ))}
          </div>
          <div className="mt-5 max-w-xs">
            <Label htmlFor="adminLanguage">{t("adminLanguage")}</Label>
            <Select
              id="adminLanguage"
              value={settings.adminLanguage}
              onChange={(e) => update({ adminLanguage: e.target.value })}
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {languages(code)}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-danger/14 text-danger [&_svg]:size-[18px]"
            >
              <Mic />
            </span>
            <div className="min-w-0 flex-1">
              <ToggleRow
                checked={settings.recordCalls}
                onChange={(checked) => update({ recordCalls: checked })}
                label={tv("recordCalls")}
                hint={tv("recordCallsHint")}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHead
            icon={<Bell />}
            title={tn("title")}
            hint={tn("hint")}
            color="var(--color-warning)"
          />
          <div className="mt-5 space-y-4">
            <ToggleRow
              checked={settings.customerConfirmations}
              onChange={(checked) => update({ customerConfirmations: checked })}
              label={tn("confirmations")}
              hint={tn("confirmationsHint")}
            />
            <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <div>
                <Label htmlFor="reminderHours">{tn("reminder")}</Label>
                <Select
                  id="reminderHours"
                  value={String(settings.reminderHours)}
                  onChange={(e) => update({ reminderHours: Number(e.target.value) })}
                >
                  {[0, 2, 12, 24, 48].map((h) => (
                    <option key={h} value={h}>
                      {h === 0 ? tn("noReminder") : tn("hoursBefore", { hours: h })}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="alertPhone">{tn("alertPhone")}</Label>
                <Input
                  id="alertPhone"
                  inputMode="tel"
                  className="tabular"
                  placeholder="07700 900123"
                  value={settings.alertPhone ?? ""}
                  onChange={(e) => update({ alertPhone: e.target.value || null })}
                />
                <p className="mt-1 text-xs text-muted-foreground">{tn("alertPhoneHint")}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead
            icon={<PhoneForwarded />}
            title={tt("title")}
            hint={tt("hint")}
            color="var(--color-info)"
          />
          <div className="mt-5 grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <div>
              <Label htmlFor="callEntry">{tt("callEntry")}</Label>
              <Select
                id="callEntry"
                value={settings.callEntry}
                onChange={(e) => update({ callEntry: e.target.value })}
              >
                <option value="direct">{tt("callEntryDirect")}</option>
                <option value="backup">{tt("callEntryBackup")}</option>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{tt("callEntryHint")}</p>
            </div>
            <ToggleRow
              checked={settings.ringFirst}
              onChange={(on) => update({ ringFirst: on })}
              label={tt("ringFirst")}
              hint={tt("ringFirstHint")}
            />
            <div>
              <Label htmlFor="handoffRoute">{tt("route")}</Label>
              <Select
                id="handoffRoute"
                value={settings.handoffRoute}
                onChange={(e) => update({ handoffRoute: e.target.value })}
              >
                <option value="people_then_phone">{tt("routePeopleThenPhone")}</option>
                <option value="people_only">{tt("routePeopleOnly")}</option>
                <option value="phone_only">{tt("routePhoneOnly")}</option>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{tt("routeHint")}</p>
            </div>
            <div>
              <Label htmlFor="ringSeconds">{tt("ringSeconds")}</Label>
              <Input
                id="ringSeconds"
                type="number"
                className="tabular"
                min={10}
                max={120}
                value={settings.ringSeconds}
                disabled={settings.handoffRoute === "phone_only"}
                onChange={(e) => update({ ringSeconds: Number(e.target.value) || 30 })}
              />
            </div>
            <div>
              <Label htmlFor="transferPhone">{tt("transferPhone")}</Label>
              <Input
                id="transferPhone"
                inputMode="tel"
                className="tabular"
                placeholder="07700 900123"
                value={settings.transferPhone ?? ""}
                onChange={(e) => update({ transferPhone: e.target.value || null })}
              />
            </div>
            <div>
              <Label htmlFor="transferHours">{tt("when")}</Label>
              <Select
                id="transferHours"
                value={settings.transferHours}
                onChange={(e) => update({ transferHours: e.target.value })}
              >
                <option value="open">{tt("whenOpen")}</option>
                <option value="always">{tt("whenAlways")}</option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="urgentSituations">{tt("urgent")}</Label>
              <Input
                id="urgentSituations"
                placeholder={tt("urgentPlaceholder")}
                maxLength={500}
                dir="auto"
                value={settings.urgentSituations ?? ""}
                onChange={(e) => update({ urgentSituations: e.target.value || null })}
              />
            </div>
            <div>
              <Label htmlFor="onCallPhone">{tt("onCall")}</Label>
              <Input
                id="onCallPhone"
                inputMode="tel"
                className="tabular"
                placeholder="07700 900456"
                value={settings.onCallPhone ?? ""}
                onChange={(e) => update({ onCallPhone: e.target.value || null })}
              />
            </div>
          </div>
          <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
            {tt("note")}
          </p>
        </Card>

        <Card>
          <CardHead
            icon={<Smile />}
            title={tf("title")}
            hint={tf("hint")}
            color="var(--color-success)"
          />
          <div className="mt-5 space-y-3 text-sm">
            <ToggleRow
              checked={settings.feedbackEnabled}
              onChange={(checked) => update({ feedbackEnabled: checked })}
              label={tf("enabled")}
            />
            <ToggleRow
              checked={settings.feedbackAfterCalls}
              disabled={!settings.feedbackEnabled}
              onChange={(checked) => update({ feedbackAfterCalls: checked })}
              label={tf("afterCalls")}
            />
            <div className="max-w-xs pt-1">
              <Label htmlFor="npsEvery">{tf("nps")}</Label>
              <Select
                id="npsEvery"
                value={String(settings.npsEvery)}
                disabled={!settings.feedbackEnabled}
                onChange={(e) => update({ npsEvery: Number(e.target.value) })}
              >
                <option value="0">{tf("npsNever")}</option>
                <option value="5">{tf("npsEvery", { n: 5 })}</option>
                <option value="10">{tf("npsEvery", { n: 10 })}</option>
              </Select>
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <div className="max-w-xl">
                <Label htmlFor="reviewLink">{tf("reviewLink")}</Label>
                <Input
                  id="reviewLink"
                  type="url"
                  inputMode="url"
                  placeholder="https://g.page/r/…/review"
                  value={settings.reviewLink ?? ""}
                  onChange={(e) => update({ reviewLink: e.target.value || null })}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">{tf("reviewLinkHint")}</p>
              </div>
              <ToggleRow
                checked={settings.reviewRequests}
                disabled={!settings.feedbackEnabled || !settings.reviewLink}
                onChange={(checked) => update({ reviewRequests: checked })}
                label={tf("reviews")}
                hint={tf("reviewsHint")}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHead
            icon={<MessageSquareReply />}
            title={tfu("title")}
            hint={tfu("hint")}
            color="var(--color-primary)"
          />
          <div className="mt-5 space-y-3 text-sm">
            <ToggleRow
              checked={settings.followUps}
              onChange={(checked) => update({ followUps: checked })}
              label={tfu("enabled")}
              hint={tfu("enabledHint")}
            />
          </div>
        </Card>

        <Card>
          <CardHead
            icon={<PhoneOutgoing />}
            title={to("title")}
            hint={to("hint")}
            color="var(--color-accent)"
          />
          <div className="mt-5 space-y-3 text-sm">
            <ToggleRow
              checked={settings.aiCallbacks}
              onChange={(checked) => update({ aiCallbacks: checked })}
              label={to("callbacks")}
            />
            <ToggleRow
              checked={settings.confirmationCalls}
              onChange={(checked) => update({ confirmationCalls: checked })}
              label={to("confirmations")}
            />
            <div className="max-w-xs pt-1">
              <Label htmlFor="outboundDailyCap">{to("cap")}</Label>
              <Input
                id="outboundDailyCap"
                type="number"
                className="tabular"
                min={1}
                max={500}
                value={settings.outboundDailyCap}
                onChange={(e) => update({ outboundDailyCap: Number(e.target.value) || 20 })}
              />
            </div>
            <p className="text-xs text-muted-foreground">{to("rules")}</p>
          </div>
        </Card>

        <Card>
          <CardHead
            icon={<Newspaper />}
            title={tb("title")}
            hint={tb("hint")}
            color="var(--color-secondary)"
          />
          <div className="mt-5">
            <ToggleRow
              checked={settings.dailyBrief}
              onChange={(checked) => update({ dailyBrief: checked })}
              label={tb("enabled")}
            />
          </div>
          <BriefPreview tenantId={props.tenantId} />
        </Card>

        <Card>
          <CardHead
            icon={<Keyboard />}
            title={tw("workspaceTitle")}
            hint={tw("workspaceHint")}
            color="var(--color-primary)"
          />
          <div className="mt-5">
            <ToggleRow
              checked={settings.voiceTyping}
              onChange={(checked) => update({ voiceTyping: checked })}
              label={tw("business")}
              hint={tw("businessHint")}
            />
          </div>
        </Card>

        {props.canEdit ? (
          <Button
            size="lg"
            className="min-w-32"
            onClick={() => void save()}
            disabled={pending || settings.enabledLanguages.length === 0}
          >
            {pending ? common("working") : t("save")}
          </Button>
        ) : null}
      </fieldset>
    </div>
  );
}

/** Shows today's brief as it would be emailed (fetched on demand; nothing is sent). */
function BriefPreview(props: { tenantId: string }) {
  const t = useTranslations("dailyBrief");
  const [brief, setBrief] = useState<{ subject: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      setBrief(
        await api<{ subject: string; text: string }>(
          `/api/tenants/${props.tenantId}/daily-brief/preview`,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4">
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void load()}>
        <Newspaper aria-hidden />
        {t("preview")}
      </Button>
      {brief ? (
        <div className="mt-3 animate-rise rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_65%,transparent)] p-4 text-sm">
          <p className="font-display font-semibold" dir="auto">
            {brief.subject}
          </p>
          <pre
            className="mt-2 border-t border-border pt-2 font-sans leading-relaxed whitespace-pre-wrap"
            data-testid="brief-preview"
            dir="auto"
          >
            {brief.text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
