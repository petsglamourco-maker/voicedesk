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
  Switch,
  type StatusTone,
} from "@voicedesk/ui";
import {
  Clock,
  Crown,
  Headset,
  MailOpen,
  MailPlus,
  PhoneIncoming,
  Send,
  ShieldCheck,
  User,
  UserMinus,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
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
          <CardHead icon={<UserPlus />} title={t("inviteTitle")} />
          <form onSubmit={onInvite} className="mt-5 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 basis-64">
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
              <Send aria-hidden />
              {pending ? common("working") : t("sendInvite")}
            </Button>
          </form>
        </Card>
      ) : (
        <Alert>{t("readOnly")}</Alert>
      )}

      <Card>
        <CardHead
          icon={<Users />}
          title={t("current")}
          color="var(--color-secondary)"
          aside={
            members.length ? (
              <Badge tone="secondary" className="tabular">
                {members.length}
              </Badge>
            ) : null
          }
        />
        <ul className="mt-4 divide-y divide-border" data-testid="member-list">
          {members.map((m) => {
            const isSelf = m.userId === props.currentUserId;
            const editable = props.canManage && !isSelf && m.role !== "owner";
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5">
                <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
                  <Avatar name={m.user.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      <span dir="auto">{m.user.name}</span>{" "}
                      {isSelf ? (
                        <span className="font-normal text-muted-foreground">({t("you")})</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" dir="auto">
                      {m.user.email}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  {answerers.get(m.userId) === "platform" ? (
                    <Badge tone="info" title={t("vaHint")}>
                      <Headset aria-hidden />
                      {t("va")}
                    </Badge>
                  ) : props.canManage ? (
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                      <Switch
                        checked={answerers.has(m.userId)}
                        disabled={pending}
                        onCheckedChange={(on) => void toggleAnswers(m.userId, on)}
                      />
                      {t("answersCalls")}
                    </label>
                  ) : answerers.has(m.userId) ? (
                    <Badge tone="success">
                      <PhoneIncoming aria-hidden />
                      {t("answersCalls")}
                    </Badge>
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
                        <UserMinus aria-hidden />
                        {t("remove")}
                      </Button>
                    </>
                  ) : (
                    <RoleBadge role={m.role} label={roles(m.role as Role)} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {props.canManage ? (
        <Card>
          <CardHead
            icon={<MailPlus />}
            title={t("pending")}
            color="var(--color-accent)"
            aside={
              invitations.length ? (
                <Badge tone="accent" className="tabular">
                  {invitations.length}
                </Badge>
              ) : null
            }
          />
          {invitations.length === 0 ? (
            <EmptyState icon={MailOpen} title={t("noPending")} className="py-8" />
          ) : (
            <ul className="mt-4 divide-y divide-border" data-testid="invitation-list">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-input text-muted-foreground"
                  >
                    <Clock className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                    {inv.email}
                  </span>
                  <RoleBadge
                    role={inv.role ?? "staff"}
                    label={roles((inv.role ?? "staff") as Role)}
                  />
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
                    <X aria-hidden />
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

const ROLE_TONE: Record<string, StatusTone> = {
  owner: "accent",
  admin: "secondary",
  staff: "neutral",
};

const ROLE_ICON: Record<string, LucideIcon> = { owner: Crown, admin: ShieldCheck, staff: User };

/** Role with its own tone and icon (colour is never the only signal). */
function RoleBadge(props: { role: string; label: string }) {
  const Icon = ROLE_ICON[props.role] ?? User;
  return (
    <Badge tone={ROLE_TONE[props.role] ?? "neutral"}>
      <Icon aria-hidden />
      {props.label}
    </Badge>
  );
}
