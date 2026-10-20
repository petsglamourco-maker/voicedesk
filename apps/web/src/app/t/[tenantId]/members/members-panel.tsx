"use client";

import { Alert, Badge, Button, Card, CardTitle, Input, Label, Select } from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

type Role = "owner" | "admin" | "staff";

interface MemberRow {
  id: string;
  role: string;
  userId: string;
  user: { name: string; email: string };
}

interface InvitationRow {
  id: string;
  email: string;
  role: string | null;
  status: string;
}

interface TeamData {
  members: MemberRow[];
  invitations: InvitationRow[];
  /** Who answers handed-off calls, and whether they're your own staff or a VA. */
  answerers: Map<string, string>;
  error: string | null;
}

async function fetchTeam(tenantId: string, includeInvitations: boolean): Promise<TeamData> {
  const [m, i, a] = await Promise.all([
    authClient.organization.listMembers({ query: { organizationId: tenantId } }),
    includeInvitations
      ? authClient.organization.listInvitations({ query: { organizationId: tenantId } })
      : Promise.resolve({ data: [] as InvitationRow[], error: null }),
    api<{ answerers: Array<{ userId: string; source: string }> }>(
      `/api/tenants/${tenantId}/answerers`,
    ).catch(() => ({ answerers: [] })),
  ]);
  const answerers = new Map(a.answerers.map((x) => [x.userId, x.source]));
  if (m.error) {
    return { members: [], invitations: [], answerers, error: m.error.message ?? "error" };
  }
  return {
    members: m.data?.members ?? [],
    invitations: (i.data ?? []).filter((x) => x.status === "pending"),
    answerers,
    error: null,
  };
}

export function MembersPanel(props: {
  tenantId: string;
  currentUserId: string;
  canManage: boolean;
  assignableRoles: Role[];
}) {
  const { tenantId } = props;
  const t = useTranslations("members");
  const roles = useTranslations("roles");
  const common = useTranslations("common");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [answerers, setAnswerers] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Bumped after each mutation to re-fetch the team.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchTeam(tenantId, props.canManage).then((team) => {
      if (cancelled) return;
      setMembers(team.members);
      setInvitations(team.invitations);
      setAnswerers(team.answerers);
      if (team.error) setError(team.error);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, props.canManage, version]);

  async function run(action: () => Promise<{ error: { message?: string } | null }>) {
    setPending(true);
    setError(null);
    setNotice(null);
    const { error } = await action();
    setPending(false);
    if (error) {
      setError(error.message ?? common("errorGeneric"));
      return false;
    }
    setVersion((v) => v + 1);
    return true;
  }

  async function toggleAnswers(userId: string, on: boolean) {
    await run(async () => {
      try {
        await api(`/api/tenants/${tenantId}/answerers/${userId}`, {
          method: "PUT",
          body: JSON.stringify({ on }),
        });
        return { error: null };
      } catch (e) {
        return { error: { message: e instanceof Error ? e.message : undefined } };
      }
    });
  }

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const email = formString(form, "email");
    const ok = await run(() =>
      authClient.organization.inviteMember({
        email,
        role: formString(form, "role") as Role,
        organizationId: tenantId,
      }),
    );
    if (ok) {
      setNotice(t("inviteSent", { email }));
      formEl.reset();
    }
  }

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {props.canManage ? (
        <Card>
          <CardTitle>{t("inviteTitle")}</CardTitle>
          <form onSubmit={onInvite} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Label htmlFor="invite-email">{t("inviteEmail")}</Label>
              <Input id="invite-email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="invite-role">{t("inviteRole")}</Label>
              <Select id="invite-role" name="role" defaultValue="staff" className="w-36">
                {props.assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {roles(r)}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? common("working") : t("sendInvite")}
            </Button>
          </form>
        </Card>
      ) : (
        <Alert>{t("readOnly")}</Alert>
      )}

      <Card>
        <CardTitle>{t("current")}</CardTitle>
        <ul className="mt-4 divide-y divide-border" data-testid="member-list">
          {members.map((m) => {
            const isSelf = m.userId === props.currentUserId;
            const editable = props.canManage && !isSelf && m.role !== "owner";
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">
                    {m.user.name}{" "}
                    {isSelf ? <span className="text-muted-foreground">({t("you")})</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.user.email}</p>
                </div>
                {answerers.get(m.userId) === "platform" ? (
                  <Badge title={t("vaHint")}>{t("va")}</Badge>
                ) : props.canManage ? (
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={answerers.has(m.userId)}
                      disabled={pending}
                      onChange={(e) => void toggleAnswers(m.userId, e.target.checked)}
                    />
                    {t("answersCalls")}
                  </label>
                ) : answerers.has(m.userId) ? (
                  <Badge>{t("answersCalls")}</Badge>
                ) : null}
                {editable ? (
                  <>
                    <Select
                      aria-label={t("changeRoleFor", { name: m.user.name })}
                      className="h-9 w-32"
                      value={m.role}
                      disabled={pending}
                      onChange={(e) =>
                        void run(() =>
                          authClient.organization.updateMemberRole({
                            memberId: m.id,
                            role: e.target.value,
                            organizationId: tenantId,
                          }),
                        )
                      }
                    >
                      {props.assignableRoles.map((r) => (
                        <option key={r} value={r}>
                          {roles(r)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        void run(() =>
                          authClient.organization.removeMember({
                            memberIdOrEmail: m.id,
                            organizationId: tenantId,
                          }),
                        )
                      }
                    >
                      {t("remove")}
                    </Button>
                  </>
                ) : (
                  <Badge>{roles(m.role as Role)}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {props.canManage ? (
        <Card>
          <CardTitle>{t("pending")}</CardTitle>
          {invitations.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("noPending")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-border" data-testid="invitation-list">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 py-3">
                  <span className="flex-1 text-sm">{inv.email}</span>
                  <Badge>{roles((inv.role ?? "staff") as Role)}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      void run(() =>
                        authClient.organization.cancelInvitation({ invitationId: inv.id }),
                      )
                    }
                  >
                    {t("cancelInvite")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
