"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Input,
  Label,
  Select,
} from "@voicedesk/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardTitle className="text-base">{t("importTitle")}</CardTitle>
        <CardDescription>{t("importHint")}</CardDescription>
        <div className="mt-3">
          <Label htmlFor="csv-file">{t("chooseFile")}</Label>
          <Input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void chooseFile(e)}
            disabled={busy}
            className="max-w-sm"
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
            <div className="grid gap-3 sm:grid-cols-3">
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
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} className="px-2 py-1 text-start font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, r) => (
                    <tr key={r} className="border-t border-border">
                      {preview.headers.map((_, c) => (
                        <td key={c} className="px-2 py-1" dir="auto">
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

      <form onSubmit={search} className="flex max-w-md gap-2">
        <Input
          name="q"
          defaultValue={props.query}
          placeholder={t("searchPlaceholder")}
          aria-label={t("search")}
        />
        <Button type="submit" variant="secondary">
          {t("search")}
        </Button>
      </form>

      <Card className="p-0">
        {props.initial.contacts.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {props.query ? t("noMatches") : t("empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="contacts">
            {props.initial.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Link
                  href={`/t/${props.tenantId}/contacts/${c.id}`}
                  className="font-medium text-primary hover:underline"
                  dir="auto"
                >
                  {c.fullName ?? c.phone ?? c.email}
                </Link>
                <span className="text-muted-foreground">{c.phone}</span>
                <span className="text-muted-foreground">{c.email}</span>
                <span className="ms-auto flex gap-1">
                  {c.marketingConsent ? <Badge>{t("marketingYes")}</Badge> : null}
                  {c.source ? <Badge>{t(`source.${c.source}` as "source.manual")}</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {t("total", { count: props.initial.total })}
        </p>
      </Card>
    </div>
  );
}
