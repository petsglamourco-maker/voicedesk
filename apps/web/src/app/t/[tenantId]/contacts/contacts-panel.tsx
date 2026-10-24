"use client";

import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHead,
  EmptyState,
  Input,
  Label,
  Select,
  StatusPill,
  type StatusTone,
} from "@voicedesk/ui";
import {
  Bot,
  FileSpreadsheet,
  FileUp,
  MailCheck,
  PenLine,
  Search,
  SearchX,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";
import { ScreenHero } from "@/components/screen-hero";

export interface ContactSummary {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  marketingConsent: boolean;
  updatedAt: string;
}

export interface ContactListResponse {
  contacts: ContactSummary[];
  total: number;
}

const SOURCE_LOOK: Record<string, { tone: StatusTone; icon: LucideIcon }> = {
  assistant: { tone: "accent", icon: Bot },
  import: { tone: "secondary", icon: FileUp },
  manual: { tone: "neutral", icon: PenLine },
};

const FIELDS = ["fullName", "phone", "email", "notes", "marketingConsent"] as const;
type Field = (typeof FIELDS)[number];

interface Preview {
  headers: string[];
  sample: string[][];
  rowCount: number;
  maxRows: number;
  mapping: Partial<Record<Field, number>>;
}

interface ImportResult {
  created: number;
  updated: number;
  duplicatesInFile: number;
  errorCount: number;
  errors: Array<{ line: number; reason: string }>;
}

/** Contact list with search and CSV import (preview → map columns → import). */
export function ContactsPanel(props: {
  tenantId: string;
  initial: ContactListResponse;
  query: string;
}) {
  const t = useTranslations("contacts");
  const shell = useTranslations("shell");
  const common = useTranslations("common");
  const router = useRouter();
  const base = `/api/tenants/${props.tenantId}/contacts`;
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = formString(new FormData(event.currentTarget), "q").trim();
    router.push(`/t/${props.tenantId}/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    if (file.size > 3_000_000) {
      setError(t("fileTooBig"));
      return;
    }
    const text = await file.text();
    setBusy(true);
    try {
      const p = await api<Preview>(`${base}/import/preview`, {
        method: "POST",
        body: JSON.stringify({ csv: text }),
      });
      setCsv(text);
      setPreview(p);
      setMapping(p.mapping);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<ImportResult>(`${base}/import`, {
          method: "POST",
          body: JSON.stringify({ csv, mapping }),
        }),
      );
      setPreview(null);
      setCsv(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="contacts"
        eyebrow={shell("groups.customers")}
        title={t("title")}
        description={t("subtitle")}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardHead
          icon={<FileSpreadsheet />}
          title={t("importTitle")}
          hint={t("importHint")}
          color="var(--color-secondary)"
        />
        <div className="mt-4 rounded-lg border border-dashed border-input/60 bg-[color-mix(in_srgb,var(--color-muted)_35%,transparent)] p-4">
          <Label htmlFor="csv-file" className="flex items-center gap-2">
            <FileUp className="size-4 shrink-0 text-secondary" aria-hidden />
            {t("chooseFile")}
          </Label>
          <Input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void chooseFile(e)}
            disabled={busy}
            className="mt-2 max-w-sm"
          />
        </div>
        {preview ? (
          <div className="mt-4 space-y-4" data-testid="import-preview">
            <p className="text-sm">
              {t("rowsFound", { count: preview.rowCount })}
              {preview.rowCount > preview.maxRows ? (
                <span className="ms-2 text-danger">
                  {t("tooManyRows", { max: preview.maxRows })}
                </span>
              ) : null}
            </p>
            <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
              {FIELDS.map((field) => (
                <div key={field}>
                  <Label htmlFor={`map-${field}`}>{t(`field.${field}`)}</Label>
                  <Select
                    id={`map-${field}`}
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [field]: e.target.value === "" ? undefined : Number(e.target.value),
                      }))
                    }
                  >
                    <option value="">{t("notInFile")}</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `#${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-[color-mix(in_srgb,var(--color-muted)_50%,transparent)] text-muted-foreground">
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-start font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, r) => (
                    <tr
                      key={r}
                      className="border-t border-border transition-colors hover:bg-muted/50"
                    >
                      {preview.headers.map((_, c) => (
                        <td key={c} className="px-3 py-2" dir="auto">
                          {row[c]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{t("lawfulBasis")}</p>
            <div className="flex gap-2">
              <Button
                onClick={() => void runImport()}
                disabled={
                  busy ||
                  preview.rowCount > preview.maxRows ||
                  (mapping.phone === undefined && mapping.email === undefined)
                }
              >
                {busy ? common("working") : t("import", { count: preview.rowCount })}
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : null}
        {result ? (
          <div className="mt-4 space-y-2" data-testid="import-result">
            <Alert tone={result.errorCount ? "error" : "success"}>
              {t("imported", {
                created: result.created,
                updated: result.updated,
                errors: result.errorCount,
              })}
            </Alert>
            {result.errors.length ? (
              <ul className="max-h-40 overflow-auto text-xs text-muted-foreground">
                {result.errors.map((e) => (
                  <li key={e.line}>{t("rowError", { line: e.line, reason: e.reason })}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      <form method="post" onSubmit={search} className="flex max-w-md gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={props.query}
            placeholder={t("searchPlaceholder")}
            aria-label={t("search")}
            className="ps-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          {t("search")}
        </Button>
      </form>

      <Card className="p-0">
        {props.initial.contacts.length === 0 ? (
          <EmptyState
            icon={props.query ? SearchX : Users}
            title={props.query ? t("noMatches") : t("empty")}
          />
        ) : (
          <ul className="space-y-2 p-3 sm:p-4" data-testid="contacts">
            {props.initial.contacts.map((c) => {
              const source = c.source ? (SOURCE_LOOK[c.source] ?? SOURCE_LOOK.manual!) : null;
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-primary/40"
                >
                  <Avatar name={c.fullName ?? c.phone ?? c.email ?? "?"} size="sm" />
                  <Link
                    href={`/t/${props.tenantId}/contacts/${c.id}`}
                    className="font-medium text-primary hover:underline"
                    dir="auto"
                  >
                    {c.fullName ?? c.phone ?? c.email}
                  </Link>
                  <span className="tabular text-muted-foreground">{c.phone}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{c.email}</span>
                  <span className="ms-auto flex flex-wrap gap-1">
                    {c.marketingConsent ? (
                      <StatusPill tone="success" icon={MailCheck} label={t("marketingYes")} />
                    ) : null}
                    {c.source && source ? (
                      <StatusPill
                        tone={source.tone}
                        icon={source.icon}
                        label={t(`source.${c.source}` as "source.manual")}
                      />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="tabular flex items-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <Users className="size-3.5 shrink-0" aria-hidden />
          {t("total", { count: props.initial.total })}
        </p>
      </Card>
    </div>
  );
}
