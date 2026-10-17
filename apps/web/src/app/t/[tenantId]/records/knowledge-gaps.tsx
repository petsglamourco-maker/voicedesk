"use client";

import { Button } from "@voicedesk/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client-api";

export interface Gap {
  id: string;
  question: string;
  createdAt: string;
}

/** Questions the assistant couldn't answer; owners add the answer, then mark them done. */
export function KnowledgeGaps(props: { tenantId: string; gaps: Gap[]; canEdit: boolean }) {
  const t = useTranslations("records");
  const [gaps, setGaps] = useState(props.gaps);

  async function resolve(id: string) {
    await api(`/api/tenants/${props.tenantId}/knowledge-gaps/${id}/resolve`, { method: "POST" });
    setGaps((g) => g.filter((x) => x.id !== id));
  }

  if (gaps.length === 0) return <p className="mt-3 text-sm text-muted-foreground">{t("noGaps")}</p>;
  return (
    <ul className="mt-3 divide-y divide-border" data-testid="knowledge-gaps">
      {gaps.map((g) => (
        <li key={g.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <span className="flex-1">{g.question}</span>
          {props.canEdit ? (
            <>
              <Link
                href={`/t/${props.tenantId}/profile`}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("addAnswer")}
              </Link>
              <Button variant="ghost" size="sm" onClick={() => void resolve(g.id)}>
                {t("markDone")}
              </Button>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
