import { cn } from "@voicedesk/ui";
import {
  CircleDot,
  ClipboardList,
  Mail,
  MessageCircle,
  Phone,
  PhoneOutgoing,
  type LucideIcon,
} from "lucide-react";
import { WhatsAppIcon } from "./shell/icons";

/**
 * One icon and colour per touchpoint, used everywhere a channel appears (Dashboard, Inbox,
 * Feedback, Records…). Labels come from `dashboard.touchpoint.*` in en.json.
 */
export const CHANNELS: Record<string, { icon: LucideIcon | typeof WhatsAppIcon; color: string }> = {
  voice: { icon: Phone, color: "var(--color-ch-voice)" },
  outbound: { icon: PhoneOutgoing, color: "var(--color-ch-outbound)" },
  web_chat: { icon: MessageCircle, color: "var(--color-ch-web)" },
  whatsapp: { icon: WhatsAppIcon, color: "var(--color-ch-whatsapp)" },
  email: { icon: Mail, color: "var(--color-ch-email)" },
  web_form: { icon: ClipboardList, color: "var(--color-ch-form)" },
};

const FALLBACK = { icon: CircleDot, color: "var(--color-muted-foreground)" };

export function channelMeta(channel: string) {
  return CHANNELS[channel] ?? FALLBACK;
}

/** The channel's icon in a softly glowing tinted circle. Pass `label` to name it for readers. */
export function ChannelDot(props: {
  channel: string;
  label?: string;
  size?: "sm" | "md";
  glow?: boolean;
  className?: string;
}) {
  const { icon: Icon, color } = channelMeta(props.channel);
  return (
    <span
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      title={props.label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        props.size === "sm" ? "size-6 [&_svg]:size-3" : "size-8 [&_svg]:size-4",
        props.className,
      )}
      style={{
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        boxShadow: props.glow === false ? undefined : `0 0 14px -4px ${color}`,
      }}
    >
      <Icon />
    </span>
  );
}
