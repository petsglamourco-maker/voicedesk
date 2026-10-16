// Shared UI primitives in the shadcn/ui style (Tailwind v4 tokens defined by the host app).
import { cva, type VariantProps } from "class-variance-authority";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
} from "react";
import { cn } from "./cn";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const buttonVariants = cva(
  `inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60 ${focusRing}`,
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "border border-border bg-surface text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        danger: "bg-danger text-white hover:bg-danger/90",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-11 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

const fieldBase = `block w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger ${focusRing}`;

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-10", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, "h-10 pe-8", className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium", className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface p-6 shadow-sm", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />;
}

const alertVariants = cva("rounded-md border px-4 py-3 text-sm", {
  variants: {
    tone: {
      info: "border-border bg-muted text-foreground",
      error: "border-danger/40 bg-danger/10 text-danger",
      success: "border-success/40 bg-success/10 text-success",
    },
  },
  defaultVariants: { tone: "info" },
});

export function Alert({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    />
  );
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}
