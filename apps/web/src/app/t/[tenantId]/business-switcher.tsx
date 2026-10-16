"use client";

import { Select } from "@voicedesk/ui";
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
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{props.label}</span>
      <Select
        className="h-9 w-56"
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
