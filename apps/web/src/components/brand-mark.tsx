import { cn } from "@voicedesk/ui";
import { Headphones } from "lucide-react";

/** The VoiceDesk mark: aurora-gradient tile with a soft glow, and the name in Sora. */
export function BrandMark(props: { size?: "md" | "lg"; className?: string; hideName?: boolean }) {
  const lg = props.size === "lg";
  return (
    <span className={cn("inline-flex items-center gap-2.5", props.className)}>
      <span
        className={cn(
          "relative flex items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--color-primary),var(--color-secondary)_60%,var(--color-accent))] shadow-[0_0_20px_0_var(--color-glow)]",
          lg ? "size-11 rounded-xl" : "size-8",
        )}
      >
        <Headphones
          className={cn("text-primary-foreground", lg ? "size-5" : "size-4")}
          aria-hidden
        />
      </span>
      <span
        className={cn(
          "font-display font-semibold tracking-tight",
          lg ? "text-2xl" : "text-[17px]",
          props.hideName && "sr-only",
        )}
      >
        VoiceDesk
      </span>
    </span>
  );
}
