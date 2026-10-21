"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  cn,
  EmptyState,
  Input,
  Label,
  Skeleton,
  StatusPill,
  Textarea,
  type StatusTone,
} from "@voicedesk/ui";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  Library,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  TextQuote,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

interface Source {
  id: string;
  type: "website" | "file" | "text";
  title: string;
  url: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  stats: { documents?: number; chunks?: number; skipped?: number };
  error: string | null;
  lastRunAt: string | null;
}

interface Hit {
  content: string;
  url: string;
  title: string | null;
  score: number;
}

const STATUS: Record<Source["status"], { tone: StatusTone; icon: LucideIcon; live?: boolean }> = {
  pending: { tone: "neutral", icon: Clock },
  processing: { tone: "info", icon: LoaderCircle, live: true },
  ready: { tone: "success", icon: CheckCircle2 },
  failed: { tone: "danger", icon: XCircle },
};

const TYPE_META: Record<Source["type"], { icon: LucideIcon; color: string }> = {
  website: { icon: Globe, color: "var(--color-secondary)" },
  file: { icon: FileText, color: "var(--color-accent)" },
  text: { icon: TextQuote, color: "var(--color-primary)" },
};

type Tab = "website" | "file" | "text";

export function KnowledgePanel({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const t = useTranslations("knowledge");
  const common = useTranslations("common");
  const format = useFormatter();
  const base = `/api/tenants/${tenantId}/knowledge`;
  const [sources, setSources] = useState<Source[] | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>("website");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);

  const busy = sources?.some((s) => s.status === "pending" || s.status === "processing") ?? false;

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void api<Source[]>(`${base}/sources`)
        .then((rows) => !cancelled && setSources(rows))
        .catch((e: Error) => !cancelled && setError(e.message));
    load();
    // Poll while anything is being processed.
    const timer = busy ? setInterval(load, 3000) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [base, version, busy]);

  async function run(action: () => Promise<unknown>, form?: HTMLFormElement) {
    setPending(true);
    setError(null);
    try {
      await action();
      form?.reset();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    if (tab === "file") {
      void run(() => api(`${base}/files`, { method: "POST", body: form }), formEl);
      return;
    }
    const payload =
      tab === "website"
        ? {
            type: "website",
            url: formString(form, "url"),
            pageLimit: Number(formString(form, "pageLimit") || 50),
          }
        : { type: "text", title: formString(form, "title"), text: formString(form, "text") };
    void run(
      () => api(`${base}/sources`, { method: "POST", body: JSON.stringify(payload) }),
      formEl,
    );
  }

  async function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = formString(new FormData(event.currentTarget), "q");
    try {
      setHits(await api<Hit[]>(`${base}/search?q=${encodeURIComponent(q)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    }
  }

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {canEdit ? (
        <Card>
          <CardHead
            icon={<Plus />}
            title={t("addTitle")}
            color="var(--color-primary)"
            className="flex-wrap"
            aside={
              <div
                role="tablist"
                aria-label={t("addTitle")}
                className="glass flex max-w-full overflow-x-auto rounded-full p-1"
              >
                {(["website", "file", "text"] as const).map((key) => {
                  const Icon = TYPE_META[key].icon;
                  return (
                    <button
                      key={key}
                      role="tab"
                      type="button"
                      aria-selected={tab === key}
                      onClick={() => setTab(key)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        tab === key
                          ? "bg-primary text-primary-foreground shadow-[0_0_18px_0_var(--color-glow)]"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {t(`tabs.${key}`)}
                    </button>
                  );
                })}
              </div>
            }
          />
          <form onSubmit={onAdd} className="mt-5 space-y-4">
            {tab === "website" ? (
              <>
                <div className="flex flex-wrap gap-3">
                  <div className="min-w-0 flex-1 basis-64">
                    <Label htmlFor="url">{t("websiteUrl")}</Label>
                    <Input id="url" name="url" placeholder="www.example.co.uk" required />
                  </div>
                  <div className="w-32">
                    <Label htmlFor="pageLimit">{t("pageLimit")}</Label>
                    <Input
                      id="pageLimit"
                      name="pageLimit"
                      type="number"
                      className="tabular"
                      min={1}
                      max={200}
                      defaultValue={50}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t("crawlNotice")}</p>
              </>
            ) : tab === "file" ? (
              <div>
                <Label htmlFor="file">{t("file")}</Label>
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept=".pdf,.docx,.csv,.txt,.md"
                  required
                  className="h-auto border-dashed py-3 file:me-3 file:rounded-full file:border-0 file:bg-primary/12 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("fileHint")}</p>
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="title">{t("textTitle")}</Label>
                  <Input id="title" name="title" required maxLength={200} dir="auto" />
                </div>
                <div>
                  <Label htmlFor="text">{t("text")}</Label>
                  <Textarea id="text" name="text" required minLength={10} rows={8} dir="auto" />
                </div>
              </>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? common("working") : t("add")}
            </Button>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHead
          icon={<Library />}
          title={t("sources")}
          color="var(--color-secondary)"
          aside={
            sources && sources.length > 0 ? (
              <Badge tone="secondary" className="tabular">
                {sources.length}
              </Badge>
            ) : null
          }
        />
        {sources && sources.length === 0 ? (
          <EmptyState icon={BookOpen} title={t("empty")} />
        ) : (
          <ul className="mt-5 space-y-2" data-testid="source-list">
            {sources === null
              ? [0, 1].map((i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <Skeleton className="size-9 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-1/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </li>
                ))
              : null}
            {(sources ?? []).map((s) => {
              const status = STATUS[s.status];
              const type = TYPE_META[s.type];
              const TypeIcon = type.icon;
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_45%,transparent)] sm:px-4",
                    s.status === "failed" ? "border-danger/40" : "border-border",
                  )}
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]"
                    style={{
                      color: type.color,
                      background: `color-mix(in srgb, ${type.color} 14%, transparent)`,
                    }}
                  >
                    <TypeIcon />
                  </span>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-semibold" dir="auto">
                      {s.title}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      {t(`tabs.${s.type}`)}
                      {s.stats.documents !== undefined
                        ? ` · ${t("stats", { documents: s.stats.documents, chunks: s.stats.chunks ?? 0 })}`
                        : ""}
                      {s.lastRunAt
                        ? ` · ${format.relativeTime(new Date(s.lastRunAt), new Date())}`
                        : ""}
                    </p>
                    {s.error ? <p className="mt-1 text-xs text-danger">{s.error}</p> : null}
                  </div>
                  <StatusPill
                    tone={status.tone}
                    icon={status.icon}
                    live={status.live}
                    label={t(`status.${s.status}`)}
                  />
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending || s.status === "processing"}
                        onClick={() =>
                          void run(() => api(`${base}/sources/${s.id}/refresh`, { method: "POST" }))
                        }
                      >
                        <RefreshCw aria-hidden />
                        {t("refresh")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        disabled={pending}
                        onClick={() =>
                          void run(() => api(`${base}/sources/${s.id}`, { method: "DELETE" }))
                        }
                      >
                        <Trash2 aria-hidden />
                        {t("delete")}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead
          icon={<Search />}
          title={t("testTitle")}
          hint={t("testSubtitle")}
          color="var(--color-accent)"
        />
        <form onSubmit={(e) => void onSearch(e)} className="mt-5 flex gap-2 sm:gap-3">
          <Input
            name="q"
            aria-label={t("testTitle")}
            placeholder={t("testPlaceholder")}
            required
            dir="auto"
            className="min-w-0"
          />
          <Button type="submit" variant="secondary">
            <Search aria-hidden />
            {t("search")}
          </Button>
        </form>
        {hits ? (
          <ul className="mt-5 space-y-3">
            {hits.length === 0 ? (
              <li>
                <EmptyState icon={SearchX} title={t("noHits")} className="py-8" />
              </li>
            ) : null}
            {hits.map((hit, i) => (
              <li
                key={i}
                className="animate-rise rounded-xl border border-border bg-[color-mix(in_srgb,var(--color-surface)_55%,transparent)] p-4 text-sm"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/14 text-[11px] font-semibold text-accent">
                    {i + 1}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
                    {hit.title ?? hit.url}
                  </p>
                  <Badge tone="accent" className="tabular">
                    {Math.round(hit.score * 100)}%
                  </Badge>
                </div>
                <p className="line-clamp-4 leading-relaxed whitespace-pre-line" dir="auto">
                  {hit.content}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
