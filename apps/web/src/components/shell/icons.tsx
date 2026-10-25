import {
  BookOpen,
  Bot,
  Building2,
  ClipboardList,
  CreditCard,
  FileText,
  FlaskConical,
  Gauge,
  Inbox,
  LayoutDashboard,
  Mail,
  MessageSquareText,
  Phone,
  Plug,
  Sparkles,
  Star,
  Sun,
  UserCog,
  Users,
  UsersRound,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/** WhatsApp's official glyph (brand icons aren't part of Lucide); drawn in its brand green. */
export function WhatsAppIcon(props: LucideProps) {
  const { className, size } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? 24}
      height={size ?? 24}
      className={className}
      aria-hidden
      fill="currentColor"
      style={{ color: "var(--color-ch-whatsapp)" }}
    >
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.79h-.01a9.85 9.85 0 0 1-5.02-1.38l-.36-.21-3.73.98 1-3.64-.24-.37a9.84 9.84 0 0 1-1.51-5.25c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88m8.41-18.3A11.81 11.81 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.31-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.49-8.41" />
    </svg>
  );
}

export type NavIcon =
  | "dashboard"
  | "today"
  | "inbox"
  | "ask"
  | "calls"
  | "contacts"
  | "records"
  | "feedback"
  | "websiteChat"
  | "whatsapp"
  | "email"
  | "forms"
  | "agent"
  | "knowledge"
  | "profile"
  | "integrations"
  | "console"
  | "members"
  | "usage"
  | "billing"
  | "account";

export const NAV_ICONS: Record<NavIcon, LucideIcon | typeof WhatsAppIcon> = {
  dashboard: LayoutDashboard,
  today: Sun,
  inbox: Inbox,
  ask: Sparkles,
  calls: Phone,
  contacts: Users,
  records: FileText,
  feedback: Star,
  websiteChat: MessageSquareText,
  whatsapp: WhatsAppIcon,
  email: Mail,
  forms: ClipboardList,
  agent: Bot,
  knowledge: BookOpen,
  profile: Building2,
  integrations: Plug,
  console: FlaskConical,
  members: UsersRound,
  usage: Gauge,
  billing: CreditCard,
  account: UserCog,
};
