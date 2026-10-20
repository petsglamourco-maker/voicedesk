"use client";

// Interactive "Aurora Glow" components on Radix primitives: accessible (focus trap, Escape,
// screen-reader roles) and keyboard-friendly by default.
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as RadioPrimitive from "@radix-ui/react-radio-group";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "./cn";
import { Button } from "./components";

// ---------- Dialog ----------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClass =
  "fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--color-background)_70%,transparent)] backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in";

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        className={cn(
          "glass fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 shadow-[0_24px_80px_-20px_rgb(0_0_0/0.6),0_0_40px_-10px_var(--color-glow)] focus:outline-none",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="font-display text-lg font-semibold tracking-tight">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1.5 text-sm text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close
          className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground rtl:right-auto rtl:left-4"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Side panel (mobile navigation, details). */
export function DrawerContent({
  className,
  children,
  title,
  side = "left",
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: ReactNode;
  side?: "left" | "right";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        className={cn(
          "glass fixed top-0 z-50 flex h-full w-[min(20rem,85vw)] flex-col p-4 focus:outline-none",
          side === "left" ? "left-0 rounded-e-xl" : "right-0 rounded-s-xl",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ---------- Confirm (replaces window.confirm: same yes/no answer) ----------

interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  destructive?: boolean;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider(props: {
  children: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
}) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {props.children}
      <Dialog open={options !== null} onOpenChange={(open) => (open ? undefined : close(false))}>
        {options ? (
          <DialogContent title={options.title} description={options.description} role="alertdialog">
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)}>
                {options.cancelLabel ?? props.cancelLabel}
              </Button>
              <Button
                variant={options.destructive ? "danger" : "primary"}
                onClick={() => close(true)}
                autoFocus
              >
                {options.confirmLabel ?? props.confirmLabel}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** `await confirm({ title })` → true / false, like window.confirm but styled and accessible. */
export function useConfirm(): (options: ConfirmOptions | string) => Promise<boolean> {
  const confirm = useContext(ConfirmContext);
  return useCallback(
    (options: ConfirmOptions | string) => {
      const opts = typeof options === "string" ? { title: options } : options;
      // Outside a provider (e.g. tests), fall back to the browser dialog.
      if (!confirm)
        return Promise.resolve(window.confirm(typeof opts.title === "string" ? opts.title : ""));
      return confirm(opts);
    },
    [confirm],
  );
}

// ---------- Tooltip ----------

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip(props: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{props.children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={props.side ?? "top"}
          sideOffset={6}
          className="z-50 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-foreground shadow-lg"
        >
          {props.content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ---------- Dropdown menu ----------

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuGroup = DropdownPrimitive.Group;

export function DropdownMenuContent({
  className,
  align = "end",
  ...props
}: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={8}
        className={cn(
          "glass z-50 min-w-52 rounded-lg p-1.5 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.5)]",
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Label>) {
  return (
    <DropdownPrimitive.Label
      className={cn("px-2.5 py-1.5 text-xs font-semibold text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;
}

export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownPrimitive.RadioItem>) {
  return (
    <DropdownPrimitive.RadioItem
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted",
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="size-4 text-primary" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.RadioItem>
  );
}

// ---------- Popover ----------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={8}
        align="end"
        className={cn(
          "glass z-50 w-80 rounded-xl p-3 shadow-[0_16px_50px_-12px_rgb(0_0_0/0.5)]",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// ---------- Tabs ----------

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("glass inline-flex items-center gap-1 rounded-lg p-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_0_16px_0_var(--color-glow)]",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;

// ---------- Switch / Checkbox / Radio ----------

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-input/60 bg-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_16px_0_var(--color-glow)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-foreground shadow transition-transform duration-200 ease-[var(--ease-spring)] data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-primary-foreground rtl:data-[state=checked]:-translate-x-[22px] rtl:-translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer flex size-5 shrink-0 items-center justify-center rounded-md border border-input bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export const RadioGroup = RadioPrimitive.Root;

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioPrimitive.Item>) {
  return (
    <RadioPrimitive.Item
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border border-input transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=checked]:border-primary",
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator className="size-2.5 rounded-full bg-primary shadow-[0_0_10px_0_var(--color-glow)]" />
    </RadioPrimitive.Item>
  );
}
