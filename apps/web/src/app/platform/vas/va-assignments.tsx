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
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

interface Assignment {
  tenantId: string;
  tenantName: string;
  userId: string;
  name: string;
  email: string;
  source: string;
}

export interface VaResponse {
  assignments: Assignment[];
  tenants: Array<{ id: string; name: string }>;
}

/** Platform admin: who answers handed-off calls for which business (Phase 5). */
export function VaAssignments({ initial }: { initial: VaResponse }) {
  const t = useTranslations("vas");
  const common = useTranslations("common");
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setData(await api<VaResponse>("/api/platform/vas"));
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void run(async () => {
      await api("/api/platform/vas", {
        method: "POST",
        body: JSON.stringify({
          email: formString(values, "email"),
          tenantId: formString(values, "tenantId"),
        }),
      });
      form.reset();
    });
  }

  const people = new Map<string, { name: string; email: string; items: Assignment[] }>();
  for (const a of data.assignments) {
    const entry = people.get(a.userId) ?? { name: a.name, email: a.email, items: [] };
    entry.items.push(a);
    people.set(a.userId, entry);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardTitle>{t("addTitle")}</CardTitle>
        <CardDescription>{t("addHint")}</CardDescription>
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="va-email">{t("email")}</Label>
            <Input id="va-email" name="email" type="email" required className="w-64" />
          </div>
          <div>
            <Label htmlFor="va-tenant">{t("business")}</Label>
            <Select id="va-tenant" name="tenantId" required className="w-56">
              {data.tenants.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? common("working") : t("add")}
          </Button>
        </form>
      </Card>

      <Card className="p-0">
        {people.size === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="va-list">
            {[...people.entries()].map(([userId, person]) => (
              <li key={userId} className="px-4 py-3 text-sm">
                <p className="font-medium">
                  {person.name} <span className="text-muted-foreground">{person.email}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {person.items.map((a) => (
                    <span
                      key={a.tenantId}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1"
                    >
                      {a.tenantName}
                      {a.source === "business" ? <Badge>{t("ownStaff")}</Badge> : null}
                      {a.source === "platform" ? (
                        <button
                          type="button"
                          className="ms-1 text-danger hover:underline"
                          aria-label={t("remove", { business: a.tenantName })}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api(`/api/platform/vas/${a.tenantId}/${userId}`, {
                                method: "DELETE",
                              });
                            })
                          }
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
