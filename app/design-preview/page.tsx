"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, SectionLabel } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import {
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerFooter,
  DrawerHeader,
} from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatCard } from "@/components/ui/stat-card";
import { TableShell, TableHead, TableBody, Th, Tr, Td } from "@/components/ui/table";
import { ToastViewport, useToast } from "@/components/ui/toast";

/**
 * /design-preview — internal-only kit showcase for the locked SmarkStock
 * design system. Not linked from app nav; visit directly during review.
 * Standing in for Storybook per the design-system brief.
 */
export default function DesignPreviewPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-14 px-6 py-12 pb-32">
      <header className="flex flex-col gap-2">
        <h1 className="text-heading font-normal text-snow">
          Smark<span className="text-smark-orange">Stock</span> design kit
        </h1>
        <p className="max-w-2xl text-body-sm text-smoke">
          Locked dark system, orange <Mono>#f57d05</Mono> — every base
          component in <Mono>components/ui</Mono> rendered against real
          content. Not a route in the product nav.
        </p>
      </header>

      <Section title="Palette" description="Surfaces, borders and text from tokens.json / app/globals.css.">
        <div className="flex flex-wrap gap-3">
          <Swatch name="obsidian" cls="bg-obsidian" />
          <Swatch name="surface" cls="bg-surface" />
          <Swatch name="ash" cls="bg-ash" />
          <Swatch name="charcoal" cls="bg-charcoal" />
          <Swatch name="slate" cls="bg-slate" />
          <Swatch name="graphite" cls="bg-graphite" />
          <Swatch name="snow" cls="bg-snow" dark />
          <Swatch name="silver-mist" cls="bg-silver-mist" dark />
          <Swatch name="smoke" cls="bg-smoke" dark />
          <Swatch name="smark-orange" cls="bg-smark-orange" dark />
          <Swatch name="orange-hover" cls="bg-smark-orange-hover" dark />
          <Swatch name="orange-soft" cls="bg-smark-orange-soft" dark />
          <Swatch name="phosphor-green" cls="bg-phosphor-green" dark />
        </div>
      </Section>

      <Section title="Button" description="Pill radius always 9999px. Orange primary is the only filled chromatic surface.">
        <Row>
          <Button variant="primary">Save part</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="accent-outline">Order more</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="primary" loading>
            Saving…
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </Row>
        <Row className="mt-4">
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" size="md">
            Medium
          </Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
          <Button variant="primary" size="xl">
            Extra large
          </Button>
        </Row>
        <div className="mt-4 max-w-xs">
          <Button variant="primary" fullWidth>
            Full width
          </Button>
        </div>
      </Section>

      <Section title="Chip" description="Status is voiced by border + text color only — no filled chromatic chips except the soft 'active filter' tone.">
        <Row>
          <Chip tone="default">Shelf 4</Chip>
          <Chip tone="neutral">128 in stock</Chip>
          <Chip tone="bright">SMK-000101</Chip>
          <Chip tone="accent">Low stock</Chip>
          <Chip tone="success">In stock</Chip>
          <Chip tone="soft">Category: MLCC</Chip>
          <Chip tone="neutral" mono>
            +240
          </Chip>
          <Chip tone="soft" onRemove={() => {}}>
            Dielectric: X7R
          </Chip>
        </Row>
      </Section>

      <Section title="Input & Field" description="#0f0f0f well, 1px charcoal border, orange border IS the focus ring.">
        <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Part value" hint="e.g. 10k, 100nF, 1206">
            <Input placeholder="10k" />
          </Field>
          <Field label="Quantity" htmlFor="qty-demo">
            <Input id="qty-demo" mono placeholder="0" defaultValue="240" />
          </Field>
          <Field label="MPN" error="No match for this code">
            <Input mono invalid defaultValue="GRM188R71H1" />
          </Field>
          <Field label="Search parts">
            <Input placeholder="Scan or type a code…" leading={<SearchIcon />} />
          </Field>
        </div>
        <Row className="mt-4">
          <Input uiSize="sm" placeholder="sm" className="w-28" />
          <Input uiSize="md" placeholder="md" className="w-28" />
          <Input uiSize="lg" placeholder="lg" className="w-28" />
          <Input placeholder="disabled" disabled className="w-32" />
        </Row>
      </Section>

      <Section title="Segmented control" description="Neutral pill for quiet toggles, accent pill where the selection is a commitment (agent tier).">
        <SegmentedDemo />
      </Section>

      <Section title="Card" description="Elevation is a 1px charcoal border on a #141414 surface — never a shadow.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <div className="text-[14px] text-smoke">Plain card</div>
            <div className="mt-1 text-[16px] text-snow">
              Default padding, surface tone
            </div>
          </Card>
          <Card tone="panel" interactive>
            <div className="text-[14px] text-smoke">Interactive · panel tone</div>
            <div className="mt-1 text-[16px] text-snow">Hover to lift the border</div>
          </Card>
          <Card padding="none">
            <CardHeader title="Movements" meta="today" />
            <CardBody>
              <SectionLabel className="mb-2">Recent</SectionLabel>
              <div className="text-[14px] text-silver-mist">
                Took out 4 × SMK-000101 from Box B-12
              </div>
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section title="Stat card" description="36px value with tabular numerals, 12px smoke label (dashboard tiles).">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard value="1,842" label="Units in stock" />
          <StatCard value="612" label="SKUs" tone="muted" />
          <StatCard value="18" label="Low stock" tone="accent" />
          <StatCard value="204" label="Movements today" tone="success" mono />
        </div>
      </Section>

      <Section title="Table shell" description="Sticky uppercase header, hairline row dividers, mono for codes/quantities.">
        <Card padding="none">
          <TableShell>
            <TableHead>
              <Tr>
                <Th>PID</Th>
                <Th>MPN</Th>
                <Th>Value</Th>
                <Th align="right">Qty</Th>
                <Th>Status</Th>
              </Tr>
            </TableHead>
            <TableBody>
              {SAMPLE_ROWS.map((r) => (
                <Tr key={r.pid} interactive>
                  <Td mono>{r.pid}</Td>
                  <Td mono>{r.mpn}</Td>
                  <Td>{r.value}</Td>
                  <Td mono align="right">
                    {r.qty}
                  </Td>
                  <Td>
                    <Chip tone={r.status === "Low" ? "accent" : "success"} size="sm">
                      {r.status}
                    </Chip>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </TableShell>
        </Card>
      </Section>

      <Section title="Empty state" description="The dashed border IS the illustration — no stock art.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <EmptyState
            icon={<UploadIcon />}
            title="Drop your filled template here"
            description="or pick a sample BOM to preview the flow"
            actions={
              <>
                <Button variant="accent-outline" className="font-mono">
                  TMCS_96x32
                </Button>
                <Button variant="outline" className="font-mono">
                  GCU_V1.1
                </Button>
              </>
            }
          />
          <EmptyState tone="subtle">
            Point the camera at an ESD-plastic or Big-Box QR — or tap a
            simulate button above.
          </EmptyState>
        </div>
      </Section>

      <Section title="Drawer" description="Right-edge shell — header/body/footer stick inside a single scroll container.">
        <DrawerDemo />
      </Section>

      <Section title="Toast" description="Bottom pill, orange Undo slot — mount one ToastViewport near the app root.">
        <ToastDemo />
      </Section>
    </main>
  );
}

/* ---------------------------------------------------------------------- */
/* Page-local scaffolding (not part of the design system export surface) */
/* ---------------------------------------------------------------------- */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border-faint pb-12 last:border-b-0 last:pb-0">
      <div className="mb-5">
        <h2 className="text-subheading font-medium text-snow">{title}</h2>
        {description && (
          <p className="mt-1 max-w-2xl text-caption text-smoke">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {children}
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.92em] text-smark-orange-soft">{children}</code>;
}

function Swatch({
  name,
  cls,
  dark = false,
}: {
  name: string;
  cls: string;
  /** Fill is light enough to need obsidian (not snow) text on top of it. */
  dark?: boolean;
}) {
  return (
    <div className="w-20 flex-none">
      <div
        className={`flex size-16 items-center justify-center rounded-2xl border border-charcoal ${cls}`}
      >
        <span
          aria-hidden
          className={`text-xs ${dark ? "text-obsidian" : "text-snow"}`}
        >
          Aa
        </span>
      </div>
      <div className="mt-1.5 truncate text-[12px] text-smoke">{name}</div>
    </div>
  );
}

function SegmentedDemo() {
  const [speed, setSpeed] = useState<"1" | "4" | "inst">("1");
  const [tier, setTier] = useState<"economy" | "balanced" | "thorough">(
    "balanced",
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 text-[12px] tracking-[0.06em] text-smoke uppercase">
          Agent-run speed (neutral)
        </div>
        <SegmentedControl
          aria-label="Agent run speed"
          value={speed}
          onChange={setSpeed}
          options={[
            { value: "1", label: "1×" },
            { value: "4", label: "4×" },
            { value: "inst", label: "Instant" },
          ]}
        />
      </div>
      <div>
        <div className="mb-2 text-[12px] tracking-[0.06em] text-smoke uppercase">
          Default agent tier (accent)
        </div>
        <SegmentedControl
          aria-label="Default agent tier"
          variant="accent"
          value={tier}
          onChange={setTier}
          options={[
            { value: "economy", label: "Economy" },
            { value: "balanced", label: "Balanced" },
            { value: "thorough", label: "Thorough" },
          ]}
        />
      </div>
    </div>
  );
}

function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open part drawer
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} aria-label="Part detail">
        <DrawerHeader>
          <div className="min-w-0">
            <div className="font-mono text-2xl text-snow">SMK-000101</div>
            <div className="mt-1 truncate font-mono text-[14px] text-silver-mist">
              GRM188R71H104KA93D
            </div>
            <div className="mt-0.5 text-[14px] text-smoke">Murata</div>
          </div>
          <div className="flex flex-none items-center gap-3">
            <Chip tone="accent">Low stock</Chip>
            <DrawerCloseButton onClick={() => setOpen(false)} />
          </div>
        </DrawerHeader>
        <DrawerBody>
          <SectionLabel className="mb-3">Specifications</SectionLabel>
          <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-divider bg-border-divider">
            {[
              ["Value", "100nF"],
              ["Voltage", "50V"],
              ["Package", "0603"],
              ["Dielectric", "X7R"],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface px-3.5 py-[11px]">
                <div className="mb-1 text-[12px] text-smoke">{k}</div>
                <div className="text-sm text-snow">{v}</div>
              </div>
            ))}
          </div>
          <SectionLabel className="mb-3">Locations</SectionLabel>
          <div className="rounded-lg border border-charcoal p-3.5 text-[14px] text-silver-mist">
            Shelf 4 · <span className="font-mono">B-12</span>
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="primary" fullWidth>
            Order more
          </Button>
          <Button variant="outline">Adjust qty</Button>
        </DrawerFooter>
      </Drawer>
    </>
  );
}

function ToastDemo() {
  const { push } = useToast();
  return (
    <>
      <Row>
        <Button
          variant="outline"
          onClick={() => push({ msg: "Opened Box B-12" })}
        >
          Simple toast
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            push({
              msg: "Took out 4 × SMK-000101 from Box B-12",
              undo: true,
              onUndo: () => push({ msg: "Undone" }),
            })
          }
        >
          Toast with Undo
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            push({
              msg: "Pick complete — movements logged",
              dismissable: true,
              timeout: 0,
            })
          }
        >
          Dismissable toast
        </Button>
      </Row>
      <ToastViewport />
    </>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

const SAMPLE_ROWS = [
  { pid: "SMK-000101", mpn: "GRM188R71H104KA93D", value: "100nF", qty: "1,240", status: "In stock" },
  { pid: "SMK-000142", mpn: "RC0603FR-0710KL", value: "10k", qty: "86", status: "Low" },
  { pid: "SMK-000188", mpn: "TMCS1123A2BQDR", value: "—", qty: "0", status: "Low" },
] as const;
