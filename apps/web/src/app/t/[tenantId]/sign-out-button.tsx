"use client";

import { Button } from "@voicedesk/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const t = useTranslations("common");
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        await authClient.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    >
      {t("signOut")}
    </Button>
  );
}
