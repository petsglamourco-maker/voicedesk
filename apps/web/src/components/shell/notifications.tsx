"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@voicedesk/ui";
import { Bell, MessageSquareText, PhoneIncoming } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

/**
 * What needs a person: chats waiting (Inbox) and calls ringing at the VA console. Uses the
 * existing inbox and VA queue endpoints; refreshes every 30 seconds.
 */
export function Notifications(props: {
  tenantId: string;
  label: string;
  notices: { chats: string; calls: string; none: string };
}) {
  const [chats, setChats] = useState(0);
  const [calls, setCalls] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [inbox, queue] = await Promise.all([
        api<{ counts: { needsHuman: number } }>(
          `/api/tenants/${props.tenantId}/inbox?filter=needs_human`,
        ).catch(() => null),
        api<{ calls: unknown[] }>("/api/va/queue").catch(() => null),
      ]);
      if (cancelled) return;
      setChats(inbox?.counts.needsHuman ?? 0);
      setCalls(queue?.calls.length ?? 0);
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [props.tenantId]);

  const total = chats + calls;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`${props.label}${total ? ` (${total})` : ""}`}
        >
          <Bell className="size-[18px]" />
          {total ? (
            <span className="absolute top-1.5 end-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground shadow-[0_0_12px_0_color-mix(in_srgb,var(--color-accent)_50%,transparent)]">
              {total}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <p className="px-2 pb-2 font-display text-sm font-semibold">{props.label}</p>
        {total === 0 ? (
          <p className="px-2 pb-2 text-sm text-muted-foreground">{props.notices.none}</p>
        ) : (
          <ul className="space-y-1">
            {calls ? (
              <li>
                <Link
                  href="/va"
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
                >
                  <PhoneIncoming className="size-4 animate-glow-pulse text-success" aria-hidden />
                  {props.notices.calls.replace("{n}", String(calls))}
                </Link>
              </li>
            ) : null}
            {chats ? (
              <li>
                <Link
                  href={`/t/${props.tenantId}/inbox`}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
                >
                  <MessageSquareText className="size-4 text-warning" aria-hidden />
                  {props.notices.chats.replace("{n}", String(chats))}
                </Link>
              </li>
            ) : null}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
