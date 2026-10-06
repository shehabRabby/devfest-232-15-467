import { formatNumber, type TranslationDictionary } from "@/lib/i18n";
import { sortRequirements } from "@/lib/requirements";
import { getRequirementStatus } from "@/lib/status";
import type { DocumentMatches, DocumentStatus, ExpiryDateState, Language, TenderData, UploadedPdf } from "@/lib/types";
import { Icon } from "./icon";

const statusStyles: Record<DocumentStatus, string> = {
  MISSING: "bg-red-50 text-red-700 ring-red-100",
  EXPIRY_NEEDED: "bg-amber-50 text-amber-800 ring-amber-200",
  EXPIRED: "bg-red-50 text-red-700 ring-red-100",
  NOT_PROVIDED: "bg-slate-100 text-slate-600 ring-slate-200",
  OK: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

interface RequirementListProps {
  data: TenderData | null;
  files: readonly UploadedPdf[];
  matches: DocumentMatches;
  expiryDates: ExpiryDateState;
  language: Language;
  t: TranslationDictionary;
  disabled: boolean;
  onMatch: (requirementId: string, fileId: string) => void;
  onExpiry: (requirementId: string, date: string) => void;
}

export function RequirementList({ data, files, matches, expiryDates, language, t, disabled, onMatch, onExpiry }: RequirementListProps) {
  if (!data) return (
    <div className="empty-state min-h-64">
      <span className="empty-icon"><Icon name="document" className="h-7 w-7" /></span>
      <h3>{t.noTender}</h3>
      <p>{t.noTenderHint}</p>
    </div>
  );
  if (data.requirements.length === 0) return <div className="empty-state"><p>{t.noRequirements}</p></div>;

  return (
    <ol className="divide-y divide-slate-100">
      {sortRequirements(data.requirements).map((requirement, index) => {
        const file = files.find((candidate) => candidate.id === matches[requirement.id]);
        const status = getRequirementStatus(requirement, file, expiryDates[requirement.id], data.tender.submission_deadline);
        const title = language === "bn" ? requirement.title_bn : requirement.title_en;
        const inputId = `requirement-${index}`;
        return (
          <li key={requirement.id} className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-lg bg-slate-100 px-1 text-xs font-semibold text-slate-500">{formatNumber(requirement.order, language)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold text-slate-800">{title}</h3>
                    <p className="mt-1 text-xs text-slate-500">{requirement.id} <span aria-hidden="true">·</span> {requirement.mandatory ? t.mandatory : t.optional}{requirement.has_expiry ? ` · ${t.needsExpiry}` : ""}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${statusStyles[status]}`}>
                    {status === "OK" && <Icon name="check" className="h-3 w-3" />}{t.statuses[status]}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className={file && requirement.has_expiry ? "" : "sm:col-span-2"}>
                    <label htmlFor={inputId} className="field-label">{t.document}</label>
                    <select id={inputId} aria-label={`${t.document}: ${title}`} className="field" disabled={disabled || files.length === 0} value={file?.id ?? ""} onChange={(event) => onMatch(requirement.id, event.target.value)}>
                      <option value="">{t.selectDocument}</option>
                      {files.map((candidate) => {
                        const inUse = Object.entries(matches).some(([id, fileId]) => id !== requirement.id && files.find((uploaded) => uploaded.id === fileId)?.sha256 === candidate.sha256);
                        return <option key={candidate.id} value={candidate.id} disabled={inUse}>{candidate.name}{inUse ? ` (${t.inUse})` : ""}</option>;
                      })}
                    </select>
                  </div>
                  {file && requirement.has_expiry && (
                    <div>
                      <label htmlFor={`${inputId}-expiry`} className="field-label">{t.expiryLabel}</label>
                      <input id={`${inputId}-expiry`} aria-describedby={`${inputId}-hint`} className="field" type="date" max="9999-12-31" disabled={disabled} value={expiryDates[requirement.id] ?? ""} onChange={(event) => onExpiry(requirement.id, event.target.value)} />
                      <p id={`${inputId}-hint`} className="mt-1.5 text-xs leading-relaxed text-slate-500">{t.expiryHint}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
