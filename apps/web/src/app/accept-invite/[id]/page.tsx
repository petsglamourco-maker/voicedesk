import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@voicedesk/ui";
import { AuthShell } from "@/components/auth-shell";
import { getMe } from "@/lib/api";
import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function AcceptInvitePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const me = await getMe();
  const t = await getTranslations("invite");
  const here = encodeURIComponent(`/accept-invite/${id}`);

  if (!me) {
    return (
      <AuthShell title={t("bodyGeneric")}>
        <div className="flex flex-col gap-3">
          <Link className={buttonVariants()} href={`/sign-up?redirect=${here}`}>
            {t("signUpToAccept")}
          </Link>
          <Link
            className={buttonVariants({ variant: "secondary" })}
            href={`/sign-in?redirect=${here}`}
          >
            {t("signInToAccept")}
          </Link>
        </div>
      </AuthShell>
    );
  }
  return <AcceptInvite invitationId={id} />;
}
