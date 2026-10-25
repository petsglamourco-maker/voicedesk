"use client";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Input,
  Label,
  Select,
  PageHero,
} from "@voicedesk/ui";
import { Building2, Headset, UserPlus, X } from "lucide-react";
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
  const platform = useTranslations("platform");
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
    <div className="stagger space-y-6">
      <PageHero
        icon={<Headset />}
        eyebrow={platform("badge")}
        title={t("title")}
        description={t("subtitle")}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardHead icon={<UserPlus />} title={t("addTitle")} hint={t("addHint")} />
        <form
          method="post"
          onSubmit={add}
          className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-end [&>*]:min-w-0"
        >
          <div>
            <Label htmlFor="va-email">{t("email")}</Label>
            <Input id="va-email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="va-tenant">{t("business")}</Label>
            <Select id="va-tenant" name="tenantId" required>
              {data.tenants.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={busy}>
            <UserPlus aria-hidden />
            {busy ? common("working") : t("add")}
          </Button>
        </form>
      </Card>

      <Card className="p-0">
        {people.size === 0 ? (
          <EmptyState icon={Headset} title={t("empty")} />
        ) : (
          <ul className="divide-y divide-border" data-testid="va-list">
            {[...people.entries()].map(([userId, person]) => (
              <li key={userId} className="flex gap-4 px-5 py-4 text-sm">
                <Avatar name={person.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    <span dir="auto">{person.name}</span>{" "}
                    <span className="font-normal break-all text-muted-foreground">
                      {person.email}
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {person.items.map((a) => (
                      <span
                        key={a.tenantId}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color-mix(in_srgb,var(--color-surface)_55%,transparent)] py-1 ps-2.5 pe-1.5 text-xs font-medium"
                      >
                        <Building2 className="size-3.5 text-secondary" aria-hidden />
                        <span dir="auto">{a.tenantName}</span>
                        {a.source === "business" ? (
                          <Badge tone="primary">{t("ownStaff")}</Badge>
                        ) : null}
                        {a.source === "platform" ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            shape="pill"
                            className="size-6 text-danger hover:bg-danger/12 [&_svg]:size-3.5"
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
                            <X aria-hidden />
                          </Button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
