"use client";

import { Button, EmptyState } from "@voicedesk/ui";
import { BookPlus, CircleCheck, MessageCircleQuestion, PartyPopper } from "lucide-react";
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

  if (gaps.length === 0)
    return <EmptyState icon={PartyPopper} title={t("noGaps")} className="py-8" />;
  return (
    <ul className="mt-4 space-y-2" data-testid="knowledge-gaps">
      {gaps.map((g) => (
        <li
          key={g.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-primary/40"
        >
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-warning/14 text-warning"
          >
            <MessageCircleQuestion className="size-3" />
          </span>
          <span className="min-w-0 flex-1 basis-48" dir="auto">
            {g.question}
          </span>
          {props.canEdit ? (
            <>
              <Link
                href={`/t/${props.tenantId}/profile`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <BookPlus className="size-4 shrink-0" aria-hidden />
                {t("addAnswer")}
              </Link>
              <Button variant="ghost" size="sm" onClick={() => void resolve(g.id)}>
                <CircleCheck aria-hidden />
                {t("markDone")}
              </Button>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
