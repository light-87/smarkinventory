import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatDate } from "@/lib/format";
import type { EmployeeDirectoryEntry } from "@/lib/employees/types";
import type { EmployeeDocType } from "@/types/db";
import { DownloadDocumentButton } from "./download-document-button";
import { EmployeeAdminControls } from "./employee-admin-controls";

const DOC_TYPE_LABELS: Record<EmployeeDocType, string> = {
  nda: "Signed NDA",
  aadhaar: "Aadhaar card",
  pan_card: "PAN card",
  nda_client: "Client NDA",
  other: "Other",
};

/**
 * Owner (+ accountant read) directory: every employee's profile info +
 * documents, each with a download link. Sensitive PAN/bank come from each
 * entry's `privateFields` (sourced from `smark_employee_private`, never
 * `smark_app_users`); it's only populated for owner/accountant callers, by
 * both that table's RLS and the page-level role gate (migration 0011 +
 * app/(app)/settings/employees/page.tsx).
 */
export function EmployeesDirectory({
  entries,
  canSeeBank,
  canEdit = false,
  archived = false,
}: {
  entries: EmployeeDirectoryEntry[];
  canSeeBank: boolean;
  /** Owner-only: render the edit / reset-password / archive controls. */
  canEdit?: boolean;
  /** These entries are archived (inactive) employees — show Reactivate + a dimmed card. */
  archived?: boolean;
}) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardBody className="p-0 text-body-sm text-smoke">
          {archived ? "No archived employees." : "No active employees yet."}
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry) => {
        const { profile, privateFields, documents } = entry;
        return (
        <Card key={profile.id} padding="none" className={archived ? "opacity-70" : undefined}>
          <CardHeader
            title={profile.display_name || profile.username}
            meta={
              <span className="flex items-center gap-2 text-smoke">
                @{profile.username}
                {archived && (
                  <Chip tone="warn" size="sm">
                    Archived
                  </Chip>
                )}
              </span>
            }
          />
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-[15px] sm:grid-cols-3">
              <div>
                <div className="text-caption text-smoke">Date of birth</div>
                <div className="text-snow">{profile.birth_date ? formatDate(profile.birth_date) : "—"}</div>
              </div>
              <div>
                <div className="text-caption text-smoke">Date of joining</div>
                <div className="text-snow">{profile.date_of_joining ? formatDate(profile.date_of_joining) : "—"}</div>
              </div>
              <div>
                <div className="text-caption text-smoke">Onboarding</div>
                <Chip tone={profile.onboarded_at ? "success" : "warn"} size="sm">
                  {profile.onboarded_at ? "Complete" : "Pending"}
                </Chip>
              </div>
              <div>
                <div className="text-caption text-smoke">Email</div>
                <div className="truncate text-snow">{privateFields?.email ?? "—"}</div>
              </div>
              <div>
                <div className="text-caption text-smoke">Phone</div>
                <div className="font-mono text-snow">{privateFields?.phone ?? "—"}</div>
              </div>
              <div>
                <div className="text-caption text-smoke">PAN number</div>
                <div className="font-mono text-snow">{privateFields?.pan_number ?? "—"}</div>
              </div>
            </div>

            {canSeeBank && (
              <div className="rounded-lg border border-charcoal p-3.5 text-[15px]">
                <div className="mb-2 text-caption text-smoke uppercase">Bank details</div>
                {privateFields?.bank_account_name ||
                privateFields?.bank_account_number ||
                privateFields?.bank_ifsc ||
                privateFields?.bank_name ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <div className="text-caption text-smoke">Holder</div>
                      <div className="text-snow">{privateFields?.bank_account_name ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-caption text-smoke">Account no.</div>
                      <div className="font-mono text-snow">{privateFields?.bank_account_number ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-caption text-smoke">IFSC</div>
                      <div className="font-mono text-snow">{privateFields?.bank_ifsc ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-caption text-smoke">Bank</div>
                      <div className="text-snow">{privateFields?.bank_name ?? "—"}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-smoke">Not provided yet.</div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div className="text-caption text-smoke uppercase">Documents ({documents.length})</div>
              {documents.length === 0 ? (
                <div className="text-body-sm text-smoke">No documents uploaded.</div>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-charcoal px-3.5 py-2.5">
                    <Chip tone="accent" size="sm">
                      {DOC_TYPE_LABELS[doc.doc_type]}
                    </Chip>
                    <span className="min-w-0 flex-1 truncate text-[15px] text-snow">
                      {doc.client_label ? `${doc.client_label} — ${doc.display_name}` : doc.display_name}
                    </span>
                    <span className="flex-none text-caption text-smoke">{formatDate(doc.created_at)}</span>
                    <DownloadDocumentButton documentId={doc.id} />
                  </div>
                ))
              )}
            </div>

            {canEdit && <EmployeeAdminControls entry={entry} archived={archived} />}
          </CardBody>
        </Card>
        );
      })}
    </div>
  );
}
