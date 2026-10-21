"use client";

import {
  Alert,
  Button,
  Card,
  CardDescription,
  CardHead,
  cn,
  Input,
  Label,
  Select,
  PageHero,
  StatusPill,
  Switch,
} from "@voicedesk/ui";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Cpu,
  KeyRound,
  Save,
  Search,
  Server,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { api } from "@/lib/client-api";

interface Options {
  thinking: { realtime: boolean; reasoning: boolean };
  thinkingControl: "deepseek" | "reasoning_effort" | "none";
  structuredOutput: "json_schema" | "json_object";
  timeoutMs: number;
  pricing: { inputPerM: number; outputPerM: number; cachedInputPerM?: number };
}

interface TestResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  error?: string;
  toolCalls?: boolean;
  contextWarning?: string;
  at: string;
}

export interface Provider {
  id: string;
  key: string;
  kind: "anthropic" | "openai_compatible";
  name: string;
  baseUrl: string | null;
  enabled: boolean;
  priority: number;
  models: { realtime: string; reasoning: string };
  options: Options;
  notes: string | null;
  apiKeyHint: string | null;
  usesEnvKey: boolean;
  ready: boolean;
  missing: string | null;
  lastTest: TestResult | null;
}

export interface ProvidersResponse {
  providers: Provider[];
  encryptionConfigured: boolean;
}

const BASE = "/api/platform/ai-providers";

export function AiProvidersPanel({ initial }: { initial: ProvidersResponse }) {
  const t = useTranslations("platform");
  const [providers, setProviders] = useState(initial.providers);
  const [error, setError] = useState<string | null>(null);

  const replace = (p: Provider) => setProviders((all) => all.map((x) => (x.id === p.id ? p : x)));

  async function move(index: number, delta: -1 | 1) {
    const order = [...providers];
    const [item] = order.splice(index, 1);
    order.splice(index + delta, 0, item!);
    setProviders(order);
    try {
      const res = await api<{ providers: Provider[] }>(`${BASE}/order`, {
        method: "POST",
        body: JSON.stringify({ ids: order.map((p) => p.id) }),
      });
      setProviders(res.providers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reorder");
    }
  }

  const active = providers.filter((p) => p.enabled && p.ready);

  return (
    <div className="stagger space-y-6">
      <PageHero
        icon={<Cpu />}
        eyebrow={t("badge")}
        title={t("aiProviders")}
        description={t("subtitle")}
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {!initial.encryptionConfigured ? <Alert tone="error">{t("noEncryption")}</Alert> : null}

      <Alert tone={active.length ? "success" : "error"} data-testid="active-order">
        {active.length
          ? t("activeOrder", { order: active.map((p) => p.name).join(" → ") })
          : t("noneActive")}
      </Alert>

      <ol className="space-y-4">
        {providers.map((p, i) => (
          <li key={p.id}>
            <ProviderCard
              provider={p}
              position={i + 1}
              canMoveUp={i > 0}
              canMoveDown={i < providers.length - 1}
              onMove={(d) => void move(i, d)}
              onChange={replace}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProviderCard(props: {
  provider: Provider;
  position: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  onChange: (p: Provider) => void;
}) {
  const { provider: p } = props;
  const t = useTranslations("platform");
  const id = useId();
  const [form, setForm] = useState({
    baseUrl: p.baseUrl ?? "",
    realtime: p.models.realtime,
    reasoning: p.models.reasoning,
    options: p.options,
  });
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<null | "save" | "toggle" | "test" | "models" | "key">(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [serverModels, setServerModels] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const openAi = p.kind === "openai_compatible";

  async function put(body: Record<string, unknown>, kind: NonNullable<typeof busy>, ok?: string) {
    setBusy(kind);
    setMessage(null);
    try {
      const updated = await api<Provider>(`${BASE}/${p.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      props.onChange(updated);
      if (ok) setMessage({ tone: "success", text: ok });
      return updated;
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : t("failed") });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMessage(null);
    try {
      const result = await api<TestResult>(`${BASE}/${p.id}/test`, { method: "POST" });
      props.onChange({ ...p, lastTest: result });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : t("failed") });
    } finally {
      setBusy(null);
    }
  }

  async function findModels() {
    setBusy("models");
    setMessage(null);
    try {
      const res = await api<{ models: string[] }>(`${BASE}/${p.id}/models`);
      setServerModels(res.models);
      setMessage({ tone: "success", text: t("modelsFound", { count: res.models.length }) });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : t("failed") });
    } finally {
      setBusy(null);
    }
  }

  const setOption = <K extends keyof Options>(key: K, value: Options[K]) =>
    setForm((f) => ({ ...f, options: { ...f.options, [key]: value } }));

  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        p.enabled && p.ready
          ? "border-success/40 shadow-[0_0_36px_-12px_color-mix(in_srgb,var(--color-success)_50%,transparent)]"
          : undefined,
      )}
      data-testid={`provider-${p.key}`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span
          className={cn(
            "tabular flex size-9 shrink-0 items-center justify-center rounded-full border font-display text-sm font-semibold",
            p.enabled && p.ready
              ? "border-primary/40 bg-primary/12 text-primary shadow-[0_0_16px_-4px_var(--color-glow)]"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          #{props.position}
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <CardHead
            icon={p.kind === "anthropic" ? <Sparkles /> : p.key === "local" ? <Server /> : <Cpu />}
            title={p.name}
            color={p.kind === "anthropic" ? "var(--color-accent)" : "var(--color-secondary)"}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {p.ready ? (
              <StatusPill tone="success" icon={CheckCircle2} label={t("ready")} />
            ) : (
              <StatusPill tone="danger" icon={KeyRound} label={p.missing} />
            )}
            {p.lastTest ? (
              <StatusPill
                tone={p.lastTest.ok ? "success" : "danger"}
                icon={p.lastTest.ok ? Activity : XCircle}
                label={
                  <span className="tabular">
                    {p.lastTest.ok
                      ? t("testOk", {
                          ms: p.lastTest.latencyMs,
                          tools: p.lastTest.toolCalls ? "✓" : "✗",
                        })
                      : t("testFailed")}
                  </span>
                }
              />
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="glass flex items-center rounded-full p-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              shape="pill"
              aria-label={t("moveUp")}
              disabled={!props.canMoveUp}
              onClick={() => props.onMove(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              shape="pill"
              aria-label={t("moveDown")}
              disabled={!props.canMoveDown}
              onClick={() => props.onMove(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Switch
              id={`${id}-enabled`}
              checked={p.enabled}
              disabled={busy !== null}
              onCheckedChange={(checked) => void put({ enabled: checked }, "toggle")}
              data-testid={`toggle-${p.key}`}
            />
            <label htmlFor={`${id}-enabled`} className="cursor-pointer">
              {p.enabled ? t("on") : t("off")}
            </label>
          </div>
        </div>
      </div>

      {p.notes ? <CardDescription className="mt-4">{p.notes}</CardDescription> : null}
      {p.lastTest && !p.lastTest.ok ? (
        <Alert tone="error" className="mt-3">
          {p.lastTest.error}
        </Alert>
      ) : null}
      {p.lastTest?.contextWarning ? (
        <Alert tone="error" className="mt-3">
          {p.lastTest.contextWarning}
        </Alert>
      ) : null}
      {message ? (
        <Alert tone={message.tone} className="mt-3">
          {message.text}
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        {openAi ? (
          <div className="sm:col-span-2">
            <Label htmlFor={`${id}-url`}>{t("baseUrl")}</Label>
            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
              <Input
                id={`${id}-url`}
                value={form.baseUrl}
                placeholder="http://localhost:8080/v1"
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void findModels()}
              >
                <Search aria-hidden />
                {t("findModels")}
              </Button>
            </div>
          </div>
        ) : null}
        <div>
          <Label htmlFor={`${id}-rt`}>{t("realtimeModel")}</Label>
          <Input
            id={`${id}-rt`}
            list={`${id}-models`}
            value={form.realtime}
            onChange={(e) => setForm({ ...form, realtime: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-rs`}>{t("reasoningModel")}</Label>
          <Input
            id={`${id}-rs`}
            list={`${id}-models`}
            value={form.reasoning}
            onChange={(e) => setForm({ ...form, reasoning: e.target.value })}
          />
        </div>
        <datalist id={`${id}-models`}>
          {serverModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      <div className="mt-4">
        <Label htmlFor={`${id}-key`}>{t("apiKey")}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={`${id}-key`}
            type="password"
            autoComplete="off"
            className="max-w-sm"
            placeholder={
              p.apiKeyHint
                ? t("keySaved", { hint: p.apiKeyHint })
                : p.usesEnvKey
                  ? t("keyFromEnv")
                  : p.key === "local"
                    ? t("keyOptional")
                    : t("keyPlaceholder")
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={busy !== null || !apiKey.trim()}
            onClick={() =>
              void put({ apiKey }, "key", t("keyStored")).then((u) => {
                if (u) setApiKey("");
              })
            }
          >
            <KeyRound aria-hidden />
            {t("saveKey")}
          </Button>
          {p.apiKeyHint ? (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void put({ apiKey: "" }, "key", t("keyRemoved"))}
            >
              {t("removeKey")}
            </Button>
          ) : null}
        </div>
      </div>

      <Button
        variant="link"
        className="mt-4 h-auto gap-1 px-0"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced((s) => !s)}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "transition-transform duration-200 rtl:rotate-180",
            showAdvanced && "rotate-90 rtl:rotate-90",
          )}
        />
        {t("advanced")}
      </Button>
      {showAdvanced ? (
        <div className="mt-3 grid gap-4 rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_45%,transparent)] p-4 sm:grid-cols-2 [&>*]:min-w-0">
          <label className="flex items-center gap-2 text-sm">
            <input
              className="size-4 accent-primary"
              type="checkbox"
              checked={form.options.thinking.realtime}
              onChange={(e) =>
                setOption("thinking", { ...form.options.thinking, realtime: e.target.checked })
              }
            />
            {t("thinkLive")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              className="size-4 accent-primary"
              type="checkbox"
              checked={form.options.thinking.reasoning}
              onChange={(e) =>
                setOption("thinking", { ...form.options.thinking, reasoning: e.target.checked })
              }
            />
            {t("thinkBackground")}
          </label>
          {openAi ? (
            <>
              <div>
                <Label htmlFor={`${id}-tc`}>{t("thinkingControl")}</Label>
                <Select
                  id={`${id}-tc`}
                  value={form.options.thinkingControl}
                  onChange={(e) =>
                    setOption("thinkingControl", e.target.value as Options["thinkingControl"])
                  }
                >
                  <option value="reasoning_effort">reasoning_effort (Ollama, LM Studio…)</option>
                  <option value="deepseek">thinking (DeepSeek)</option>
                  <option value="none">{t("notSupported")}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor={`${id}-so`}>{t("structuredOutput")}</Label>
                <Select
                  id={`${id}-so`}
                  value={form.options.structuredOutput}
                  onChange={(e) =>
                    setOption("structuredOutput", e.target.value as Options["structuredOutput"])
                  }
                >
                  <option value="json_schema">json_schema</option>
                  <option value="json_object">json_object</option>
                </Select>
              </div>
              <div>
                <Label htmlFor={`${id}-pin`}>{t("priceIn")}</Label>
                <Input
                  id={`${id}-pin`}
                  type="number"
                  min={0}
                  step="0.001"
                  value={form.options.pricing.inputPerM}
                  onChange={(e) =>
                    setOption("pricing", {
                      ...form.options.pricing,
                      inputPerM: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`${id}-pout`}>{t("priceOut")}</Label>
                <Input
                  id={`${id}-pout`}
                  type="number"
                  min={0}
                  step="0.001"
                  value={form.options.pricing.outputPerM}
                  onChange={(e) =>
                    setOption("pricing", {
                      ...form.options.pricing,
                      outputPerM: Number(e.target.value),
                    })
                  }
                />
              </div>
            </>
          ) : null}
          <div>
            <Label htmlFor={`${id}-to`}>{t("timeout")}</Label>
            <Input
              id={`${id}-to`}
              type="number"
              min={5}
              max={900}
              value={Math.round(form.options.timeoutMs / 1000)}
              onChange={(e) => setOption("timeoutMs", Number(e.target.value) * 1000)}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          disabled={busy !== null}
          onClick={() =>
            void put(
              {
                ...(openAi ? { baseUrl: form.baseUrl.trim() } : {}),
                models: { realtime: form.realtime.trim(), reasoning: form.reasoning.trim() },
                options: form.options,
              },
              "save",
              t("saved"),
            )
          }
        >
          <Save aria-hidden />
          {busy === "save" ? t("saving") : t("save")}
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== null || !p.ready}
          onClick={() => void test()}
        >
          <Zap aria-hidden />
          {busy === "test" ? t("testing") : t("test")}
        </Button>
      </div>
    </Card>
  );
}
