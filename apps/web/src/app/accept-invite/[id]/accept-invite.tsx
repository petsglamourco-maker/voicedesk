"use client";

import { Alert, Button } from "@voicedesk/ui";
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
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {info ? (
        <p className="mb-6 text-sm">
          {t("body", {
            organization: info.organizationName,
            role: roles(info.role as "staff"),
          })}
        </p>
      ) : null}
      <Button className="w-full" onClick={() => void accept()} disabled={pending || !info}>
        {pending ? common("working") : t("accept")}
      </Button>
    </AuthShell>
  );
}
