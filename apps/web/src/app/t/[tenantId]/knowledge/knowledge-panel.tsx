"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  cn,
  Input,
  Label,
} from "@voicedesk/ui";
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

const STATUS_STYLES: Record<Source["status"], string> = {
  pending: "",
  processing: "border-primary/40 text-primary",
  ready: "border-success/40 text-success",
  failed: "border-danger/40 text-danger",
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
          <CardTitle>{t("addTitle")}</CardTitle>
          <div role="tablist" aria-label={t("addTitle")} className="mt-4 flex gap-1">
            {(["website", "file", "text"] as const).map((key) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  tab === key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {t(`tabs.${key}`)}
              </button>
            ))}
          </div>
          <form onSubmit={onAdd} className="mt-4 space-y-4">
            {tab === "website" ? (
              <>
                <div className="flex flex-wrap gap-3">
                  <div className="min-w-64 flex-1">
                    <Label htmlFor="url">{t("websiteUrl")}</Label>
                    <Input id="url" name="url" placeholder="www.example.co.uk" required />
                  </div>
                  <div className="w-32">
                    <Label htmlFor="pageLimit">{t("pageLimit")}</Label>
                    <Input
                      id="pageLimit"
                      name="pageLimit"
                      type="number"
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
                  className="h-auto py-2"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("fileHint")}</p>
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="title">{t("textTitle")}</Label>
                  <Input id="title" name="title" required maxLength={200} />
                </div>
                <div>
                  <Label htmlFor="text">{t("text")}</Label>
                  <textarea
                    id="text"
                    name="text"
                    required
                    minLength={10}
                    rows={8}
                    className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                  />
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
        <CardTitle>{t("sources")}</CardTitle>
        {sources && sources.length === 0 ? (
          <CardDescription>{t("empty")}</CardDescription>
        ) : (
          <ul className="mt-4 divide-y divide-border" data-testid="source-list">
            {(sources ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-56 flex-1">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
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
                <Badge className={STATUS_STYLES[s.status]}>{t(`status.${s.status}`)}</Badge>
                {canEdit ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending || s.status === "processing"}
                      onClick={() =>
                        void run(() => api(`${base}/sources/${s.id}/refresh`, { method: "POST" }))
                      }
                    >
                      {t("refresh")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        void run(() => api(`${base}/sources/${s.id}`, { method: "DELETE" }))
                      }
                    >
                      {t("delete")}
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>{t("testTitle")}</CardTitle>
        <CardDescription>{t("testSubtitle")}</CardDescription>
        <form onSubmit={(e) => void onSearch(e)} className="mt-4 flex gap-3">
          <Input name="q" aria-label={t("testTitle")} placeholder={t("testPlaceholder")} required />
          <Button type="submit" variant="secondary">
            {t("search")}
          </Button>
        </form>
        {hits ? (
          <ul className="mt-4 space-y-3">
            {hits.length === 0 ? <li className="text-sm">{t("noHits")}</li> : null}
            {hits.map((hit, i) => (
              <li key={i} className="rounded-md border border-border p-3 text-sm">
                <p className="mb-1 text-xs text-muted-foreground">
                  {hit.title ?? hit.url} · {Math.round(hit.score * 100)}%
                </p>
                <p className="line-clamp-4 whitespace-pre-line">{hit.content}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
