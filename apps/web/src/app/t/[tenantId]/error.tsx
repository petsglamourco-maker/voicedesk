"use client";

import { Button, EmptyState } from "@voicedesk/ui";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

/** A screen failed to load: say so kindly and offer a retry, instead of a blank page. */
export default function ScreenError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("shell");
  return (
    <div className="glass rounded-xl">
      <EmptyState
        icon={TriangleAlert}
        title={t("errorTitle")}
        description={t("errorBody")}
        action={
          <Button onClick={() => props.reset()}>
            <RefreshCw aria-hidden />
            {t("retry")}
          </Button>
        }
      />
    </div>
  );
}
