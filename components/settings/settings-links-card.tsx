import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export interface SettingsLinkRow {
  href: string;
  title: string;
  description: string;
}

/**
 * Link-out rows to sections other packages own (docs/OWNERSHIP.md): Users &
 * roles (auth-shell's `app/(app)/settings/users/**`). This card only
 * navigates there — it never renders their data or duplicates their writes.
 */
export function SettingsLinksCard({ rows }: { rows: SettingsLinkRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Card padding="none">
      <CardHeader title="More settings" />
      <CardBody className="flex flex-col divide-y divide-border-faint p-0">
        {rows.map((row) => (
          <Link
            key={row.href}
            href={row.href}
            className="flex min-h-11 items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface-hover"
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] text-snow">{row.title}</span>
              <span className="block truncate text-caption text-smoke">{row.description}</span>
            </span>
            <span aria-hidden className="flex-none text-smoke">
              →
            </span>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}

/** Static baseline card (plan/tab-settings.md §2) — no write surface, nothing to wire. */
export function ConnectedAccountsCard() {
  const accounts = ["Vercel", "Supabase", "Claude"];
  return (
    <Card padding="none">
      <CardHeader title="Connected accounts" meta={<span className="text-smoke">you own these</span>} />
      <CardBody>
        <div className="flex flex-wrap gap-2.5">
          {accounts.map((name) => (
            <span key={name} className="rounded-full border border-charcoal px-4 py-1.5 text-[15px] text-snow">
              {name}
            </span>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
