"use client";

import { Alert, Button, Skeleton } from "@voicedesk/ui";
import { Check, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";

interface InvitationInfo {
  organizationId: string;
  organizationName: string;
  role: string;
}

export function AcceptInvite({ invitationId }: { invitationId: string }) {
  const t = useTranslations("invite");
  const roles = useTranslations("roles");
  const common = useTranslations("common");
  const router = useRouter();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void authClient.organization
      .getInvitation({ query: { id: invitationId } })
      .then(({ data, error }) => {
        if (error || !data) return setInvalid(true);
        setInfo({
          organizationId: data.organizationId,
          organizationName: data.organizationName,
          role: data.role,
        });
      });
  }, [invitationId]);

  async function accept() {
    setPending(true);
    const { data, error } = await authClient.organization.acceptInvitation({ invitationId });
    if (error || !data) {
      setPending(false);
      return setError(error?.message ?? common("errorGeneric"));
    }
    const orgId = data.invitation.organizationId;
    await authClient.organization.setActive({ organizationId: orgId });
    router.push(`/t/${orgId}`);
    router.refresh();
  }

  if (invalid) {
    return (
      <AuthShell title={t("bodyGeneric")}>
        <Alert tone="error">{t("invalid")}</Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={info ? t("title", { organization: info.organizationName }) : t("bodyGeneric")}
    >
      {error ? (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      ) : null}
      {info ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_55%,transparent)] p-4">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/14 text-primary shadow-[0_0_18px_-6px_var(--color-glow)]"
          >
            <UsersRound className="size-5" />
          </span>
          <p className="min-w-0 text-[15px] leading-relaxed">
            {t("body", {
              organization: info.organizationName,
              role: roles(info.role as "staff"),
            })}
          </p>
        </div>
      ) : (
        <div aria-hidden className="mb-6 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      <Button
        size="lg"
        className="w-full"
        onClick={() => void accept()}
        disabled={pending || !info}
      >
        <Check aria-hidden />
        {pending ? common("working") : t("accept")}
      </Button>
    </AuthShell>
  );
}
