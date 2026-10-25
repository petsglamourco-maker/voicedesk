"use client";

import { Select } from "@voicedesk/ui";
import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const NEW = "__new__";

export function BusinessSwitcher(props: {
  currentId: string;
  tenants: Array<{ id: string; name: string }>;
  label: string;
  newLabel: string;
}) {
  const router = useRouter();

  async function onChange(value: string) {
    if (value === NEW) return router.push("/onboarding");
    await authClient.organization.setActive({ organizationId: value });
    router.push(`/t/${value}`);
    router.refresh();
  }

  return (
    <label className="relative flex items-center text-sm">
      <span className="sr-only">{props.label}</span>
      <Building2
        aria-hidden
        className="pointer-events-none absolute start-3 size-4 text-primary drop-shadow-[0_0_6px_var(--color-glow)]"
      />
      <Select
        className="glass h-9 w-56 max-w-[60vw] rounded-full ps-9 text-sm font-semibold"
        value={props.currentId}
        onChange={(e) => void onChange(e.target.value)}
        data-testid="business-switcher"
      >
        {props.tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        <option value={NEW}>+ {props.newLabel}</option>
      </Select>
    </label>
  );
}
