"use client";

// Fixture copy below is sample content for the gallery, not product UI.
import {
  Alert,
  AuroraBackground,
  Avatar,
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogTrigger,
  DrawerContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  KpiCard,
  Kbd,
  Label,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Select,
  Skeleton,
  StatusPill,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  useConfirm,
} from "@voicedesk/ui";
import {
  CheckCircle2,
  Clock,
  Inbox,
  MessageSquareText,
  Moon,
  PhoneCall,
  Plus,
  Radio,
  Sparkles,
  Star,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AreaChart,
  BarList,
  Donut,
  Funnel,
  Heatmap,
  LineChart,
  RadialGauge,
  ShareBar,
  Sparkline,
  StackedBars,
} from "@/components/charts";
import { THEME_COOKIE } from "@/lib/theme";
import type { GalleryLabels } from "./labels";

const COLOURS = [
  "background",
  "surface",
  "surface-raised",
  "muted",
  "border",
  "input",
  "foreground",
  "muted-foreground",
  "primary",
  "secondary",
  "accent",
  "info",
  "success",
  "warning",
  "danger",
  "aurora-1",
  "aurora-2",
  "aurora-3",
  "ch-voice",
  "ch-outbound",
  "ch-web",
  "ch-whatsapp",
  "ch-email",
  "ch-form",
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const v = (name: string) => `var(--color-${name})`;
const SERIES = [
  { key: "voice", label: "Calls", color: v("ch-voice"), values: [12, 18, 15, 22, 19, 8, 5] },
  { key: "web", label: "Website chat", color: v("ch-web"), values: [6, 9, 7, 11, 14, 4, 3] },
  { key: "wa", label: "WhatsApp", color: v("ch-whatsapp"), values: [4, 5, 8, 6, 9, 7, 6] },
  { key: "email", label: "Email", color: v("ch-email"), values: [3, 2, 4, 3, 5, 1, 0] },
];
const HEAT = Array.from({ length: 7 }, (_, d) =>
  Array.from({ length: 24 }, (_, h) =>
    h < 8 || h > 19 ? 0 : Math.round(((h * 7 + d * 13) % 9) * (d > 4 ? 0.4 : 1)),
  ),
);
const ROWS = [
  { id: "1", name: "Amelia Hart", channel: "Calls", status: "Booked", minutes: 4.2 },
  { id: "2", name: "Omar Haddad", channel: "WhatsApp", status: "Needs a person", minutes: 2.1 },
  { id: "3", name: "Li Wei", channel: "Website chat", status: "Answered", minutes: 1.4 },
  { id: "4", name: "Sofia Rossi", channel: "Email", status: "Answered", minutes: 3.8 },
];
const TONES = [
  "neutral",
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "danger",
  "info",
] as const;

function applyTheme(next: "dark" | "light") {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
  document.documentElement.dataset.theme = next;
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-tight">{props.title}</h2>
      {props.children}
    </section>
  );
}

export function Gallery(props: { labels: GalleryLabels; initialMode: "dark" | "light" }) {
  const l = props.labels;
  const confirm = useConfirm();
  const [mode, setMode] = useState(props.initialMode);
  const [recording, setRecording] = useState(true);

  function switchMode(next: "dark" | "light") {
    setMode(next);
    applyTheme(next);
  }

  return (
    <div className="relative min-h-screen">
      <AuroraBackground />
      <main id="main" className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        <PageHeader
          eyebrow="Aurora Glow"
          title={l.title}
          description={l.description}
          actions={
            <div className="glass flex rounded-full p-1" role="group" aria-label={l.title}>
              {(
                [
                  ["dark", Moon, l.dark],
                  ["light", Sun, l.light],
                ] as const
              ).map(([m, Icon, label]) => (
                <Button
                  key={m}
                  size="sm"
                  shape="pill"
                  variant={mode === m ? "primary" : "ghost"}
                  aria-pressed={mode === m}
                  onClick={() => switchMode(m)}
                >
                  <Icon aria-hidden />
                  {label}
                </Button>
              ))}
            </div>
          }
        />

        <Section title={l.colours}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {COLOURS.map((c) => (
              <div key={c} className="glass overflow-hidden rounded-lg">
                <div className="h-14 border-b border-border" style={{ background: v(c) }} />
                <p className="px-3 py-2 font-mono text-xs">{c}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title={l.type}>
          <Card className="space-y-3">
            <p className="font-display text-[40px] leading-tight font-semibold tracking-tight">
              Display 40 · Sora
            </p>
            <p className="font-display text-[32px] font-semibold tracking-tight">Title 32 · Sora</p>
            <p className="font-display text-xl font-semibold">Section 20 · Sora</p>
            <p className="text-[15px]">Body 15 · Manrope. The quick brown fox answers the phone.</p>
            <p className="text-sm text-muted-foreground">Secondary 14 · muted foreground</p>
            <p className="text-aurora tabular font-display text-[56px] leading-none font-semibold">
              1,284
            </p>
          </Card>
        </Section>

        <Section title={l.buttons}>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="accent">
              <Sparkles aria-hidden /> Accent
            </Button>
            <Button variant="danger">Delete</Button>
            <Button variant="link">Link</Button>
            <Button shape="pill">
              <Plus aria-hidden /> Pill
            </Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" variant="secondary" aria-label="Call">
              <PhoneCall aria-hidden />
            </Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title={l.forms}>
          <Card className="grid gap-5 sm:grid-cols-2">
            <Field id="g-name" label="Business name" hint="Shown to callers.">
              <Input
                id="g-name"
                aria-describedby="g-name-hint"
                defaultValue="Bright Smile Dental"
              />
            </Field>
            <Field
              id="g-email"
              label="Email"
              error="Enter an email address, like name@example.com."
            >
              <Input
                id="g-email"
                aria-describedby="g-email-error"
                aria-invalid
                defaultValue="name@"
              />
            </Field>
            <Field id="g-lang" label="Language">
              <Select id="g-lang" defaultValue="en">
                <option value="en">English</option>
                <option value="es">Español</option>
              </Select>
            </Field>
            <div className="space-y-2">
              <Label htmlFor="g-notes">Notes</Label>
              <Textarea id="g-notes" placeholder="Anything the assistant should know…" />
            </div>
          </Card>
        </Section>

        <Section title={l.surfaces}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["glass", "solid", "hero", "ghost"] as const).map((variant) => (
              <Card key={variant} variant={variant}>
                <CardTitle>{variant}</CardTitle>
                <CardDescription>Card variant “{variant}”.</CardDescription>
              </Card>
            ))}
          </div>
        </Section>

        <Section title={l.status}>
          <div className="flex flex-wrap gap-2">
            {TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="success" icon={CheckCircle2} label="Answered" />
            <StatusPill tone="warning" icon={TriangleAlert} label="Needs a person" />
            <StatusPill tone="info" icon={Clock} label="Waiting" />
            <StatusPill tone="primary" icon={Radio} label="Live" live />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Alert tone="info">The assistant uses your approved profile only.</Alert>
            <Alert tone="success">Saved. Your assistant now uses the new hours.</Alert>
            <Alert tone="warning">Google Calendar needs reconnecting.</Alert>
            <Alert tone="error">Couldn’t save. Check the phone number format (+44…).</Alert>
          </div>
        </Section>

        <Section title={l.kpis}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              hero
              className="sm:col-span-2"
              label="Conversations this week"
              value={1284}
              icon={<MessageSquareText />}
              trend={{ delta: 18, label: "vs last week" }}
              chart={<Sparkline values={[8, 12, 9, 15, 18, 14, 22]} color={v("primary")} />}
            />
            <KpiCard
              label="Median reply"
              value={1.5}
              decimals={1}
              suffix=" s"
              icon={<Clock />}
              trend={{ delta: -12, goodWhen: "down" }}
            />
            <KpiCard
              label="Rating"
              value={4.8}
              decimals={1}
              icon={<Star />}
              trend={{ delta: -3 }}
            />
          </div>
        </Section>

        <Section title={l.charts}>
          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <div className="glass aurora-border relative overflow-hidden rounded-xl p-6 lg:col-span-2">
              <div aria-hidden className="spotlight pointer-events-none absolute inset-0" />
              <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />
              <p className="text-aurora relative font-display text-[56px] leading-none font-semibold">
                128
              </p>
              <AreaChart
                className="relative mt-4"
                labels={DAYS}
                values={[14, 18, 12, 22, 26, 19, 17]}
                unit=" conversations"
                emptyText="No data"
              />
            </div>
            <Card className="flex items-center">
              <RadialGauge value={72} label="Handled by the assistant" />
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <StackedBars labels={DAYS} series={SERIES} emptyText="No data" />
            </Card>
            <Card>
              <LineChart
                labels={DAYS}
                values={[1800, 1650, 1500, 1720, 1400, 1380, 1520]}
                color={v("secondary")}
                divide={1000}
                decimals={1}
                unit=" s"
                emptyText="No data"
              />
            </Card>
            <Card>
              <Donut
                centerLabel="chats"
                emptyText="No data"
                segments={SERIES.map((s) => ({
                  label: s.label,
                  value: s.values.reduce((a, b) => a + b, 0),
                  color: s.color,
                }))}
              />
            </Card>
            <Card className="space-y-6">
              <ShareBar
                emptyText="No data"
                parts={SERIES.map((s) => ({ label: s.label, value: s.values[3]!, color: s.color }))}
              />
              <BarList
                emptyText="No data"
                items={[
                  { label: "Book an appointment", value: 42 },
                  { label: "Opening hours", value: 27 },
                  { label: "Prices", value: 15 },
                ]}
              />
              <Funnel
                steps={[
                  { label: "Enquiries", value: 120 },
                  { label: "Qualified", value: 74 },
                  { label: "Booked", value: 41 },
                ]}
              />
            </Card>
            <Card className="lg:col-span-2">
              <Heatmap grid={HEAT} days={DAYS} emptyText="No data" />
            </Card>
          </div>
        </Section>

        <Section title={l.overlays}>
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Dialog</Button>
              </DialogTrigger>
              <DialogContent title="Invite a teammate" description="They’ll get an email link.">
                <Field id="g-invite" label="Email">
                  <Input id="g-invite" placeholder="name@example.com" />
                </Field>
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Drawer</Button>
              </DialogTrigger>
              <DrawerContent title="Conversation details">
                <p className="text-sm text-muted-foreground">Side panel content.</p>
              </DrawerContent>
            </Dialog>
            <Button
              variant="secondary"
              onClick={async () => {
                const ok = await confirm({
                  title: "Remove this contact?",
                  description: "Their past conversations stay in Records.",
                  destructive: true,
                  confirmLabel: "Remove",
                });
                toast(ok ? "Removed" : "Kept");
              }}
            >
              Confirm
            </Button>
            <Button variant="secondary" onClick={() => toast.success("Booking confirmed")}>
              Toast
            </Button>
            <Tooltip content="Answer the next call">
              <Button variant="secondary">Tooltip</Button>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">Menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem>Take over</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Mark as done</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <p className="p-2 text-sm">Popover content.</p>
              </PopoverContent>
            </Popover>
          </div>
        </Section>

        <Section title={l.controls}>
          <Card className="space-y-6">
            <Tabs defaultValue="week">
              <TabsList>
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
              </TabsList>
              <TabsContent value="week" className="pt-3 text-sm text-muted-foreground">
                Week view
              </TabsContent>
            </Tabs>
            <div className="flex flex-wrap items-center gap-8">
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={recording} onCheckedChange={setRecording} /> Record calls
              </label>
              <label className="flex items-center gap-3 text-sm">
                <Checkbox defaultChecked /> Email me a summary
              </label>
              <RadioGroup defaultValue="warm" className="flex gap-5">
                {["warm", "formal"].map((x) => (
                  <label key={x} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value={x} /> {x}
                  </label>
                ))}
              </RadioGroup>
            </div>
          </Card>
        </Section>

        <Section title={l.display}>
          <Card className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar name="Amelia Hart" size="sm" />
              <Avatar name="Omar Haddad" />
              <Avatar name="Li Wei" size="lg" />
              <span className="ms-4 text-sm">
                Search <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>
              </span>
            </div>
            <Progress value={64} label="Setup progress" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          </Card>
        </Section>

        <Section title={l.empty}>
          <Card>
            <EmptyState
              icon={Inbox}
              title="No conversations yet"
              description="When customers call or message, they’ll appear here."
              action={<Button>Try the test console</Button>}
            />
          </Card>
        </Section>

        <Section title={l.table}>
          <DataTable
            rows={ROWS}
            rowKey={(r) => r.id}
            empty="No rows"
            densityLabels={{ comfortable: "Comfortable", compact: "Compact" }}
            columns={[
              {
                key: "name",
                header: "Customer",
                sortValue: (r) => r.name,
                cell: (r) => (
                  <span className="flex items-center gap-2">
                    <Avatar name={r.name} size="sm" />
                    {r.name}
                  </span>
                ),
              },
              {
                key: "channel",
                header: "Channel",
                sortValue: (r) => r.channel,
                cell: (r) => r.channel,
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => (
                  <StatusPill
                    tone={r.status === "Needs a person" ? "warning" : "success"}
                    label={r.status}
                  />
                ),
              },
              {
                key: "minutes",
                header: "Minutes",
                align: "end",
                sortValue: (r) => r.minutes,
                cell: (r) => <span className="tabular">{r.minutes.toFixed(1)}</span>,
              },
            ]}
          />
        </Section>
      </main>
    </div>
  );
}
