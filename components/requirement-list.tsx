import { formatNumber, type TranslationDictionary } from "@/lib/i18n";
import { getFileAssignment } from "@/lib/matching";
import { sortRequirements } from "@/lib/requirements";
import { getRequirementStatus } from "@/lib/status";
import type { DocumentMatches, DocumentStatus, ExpiryDateState, Language, TenderData, UploadedPdf } from "@/lib/types";
import { Icon } from "./icon";

const statusStyles: Record<DocumentStatus, string> = {
  MISSING: "bg-red-50 text-red-800 ring-red-200",
  EXPIRY_NEEDED: "bg-amber-50 text-amber-800 ring-amber-200",
  EXPIRED: "bg-red-50 text-red-800 ring-red-200",
  NOT_PROVIDED: "bg-slate-100 text-slate-600 ring-slate-200",
  OK: "bg-emerald-50 text-emerald-800 ring-emerald-200",
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
    <div className="empty-state">
      <span className="empty-icon"><Icon name="document" className="h-7 w-7" /></span>
      <h3>{t.noTender}</h3>
      <p>{t.noTenderHint}</p>
    </div>
  );
  if (data.requirements.length === 0) return <div className="empty-state"><p>{t.noRequirements}</p></div>;

  return (
    <ol className="divide-y divide-slate-200/80">
      {sortRequirements(data.requirements).map((requirement, index) => {
        const file = files.find((candidate) => candidate.id === matches[requirement.id]);
        const status = getRequirementStatus(requirement, file, expiryDates[requirement.id], data.tender.submission_deadline);
        const title = language === "bn" ? requirement.title_bn : requirement.title_en;
        const inputId = `requirement-${index}`;
        return (
          <li key={requirement.id} className="p-4 transition-colors duration-200 hover:bg-slate-50/40 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-1 text-xs font-semibold tabular-nums text-slate-600">{formatNumber(requirement.order, language)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold leading-relaxed text-slate-900">{title}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs leading-relaxed">
                      <span className="break-all font-medium text-slate-500">{requirement.id}</span>
                      <span className={`rounded-md px-1.5 py-0.5 ${requirement.mandatory ? "bg-slate-100 font-medium text-slate-700" : "bg-slate-50 text-slate-500"}`}>{requirement.mandatory ? t.mandatory : t.optional}</span>
                      {requirement.has_expiry && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-800">{t.needsExpiry}</span>}
                    </div>
                  </div>
                  <span aria-live="polite" aria-atomic="true" className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-relaxed ring-1 ring-inset ${statusStyles[status]}`}>
                    {status === "OK" && <Icon name="check" className="h-3 w-3 shrink-0" />}{t.statuses[status]}
                  </span>
                </div>
                <p id={`${inputId}-status`} className={`mt-2 text-xs leading-relaxed ${status === "EXPIRED" ? "text-red-700" : "text-slate-500"}`}>{t.statusHints[status]}</p>
                <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className={file && requirement.has_expiry ? "min-w-0" : "min-w-0 sm:col-span-2"}>
                    <label htmlFor={inputId} className="field-label">{file ? t.changeDocument : t.document}</label>
                    <select id={inputId} aria-label={`${t.document}: ${title}`} aria-describedby={`${inputId}-status${files.length === 0 ? ` ${inputId}-empty` : ""}`} title={file?.name} className="field" disabled={disabled || files.length === 0} value={file?.id ?? ""} onChange={(event) => onMatch(requirement.id, event.target.value)}>
                      <option value="">{t.selectDocument}</option>
                      {files.map((candidate) => {
                        const assignment = getFileAssignment(candidate, matches, files, requirement.id);
                        const owner = data.requirements.find((item) => item.id === assignment?.requirementId);
                        const ownerTitle = owner ? language === "bn" ? owner.title_bn : owner.title_en : assignment?.requirementId;
                        const explanation = assignment ? `${assignment.isDuplicate ? t.sameContentInUse : t.inUse}: ${ownerTitle}` : "";
                        return <option key={candidate.id} value={candidate.id} disabled={assignment !== null}>{candidate.name}{assignment ? ` (${explanation})` : ""}</option>;
                      })}
                    </select>
                    {files.length === 0 && <p id={`${inputId}-empty`} className="mt-1.5 text-xs leading-relaxed text-slate-500">{t.noPdfsForMatching}</p>}
                  </div>
                  {file && requirement.has_expiry && (
                    <div className="min-w-0">
                      <label htmlFor={`${inputId}-expiry`} className="field-label">{t.expiryLabel}</label>
                      <input id={`${inputId}-expiry`} aria-describedby={`${inputId}-hint ${inputId}-status`} aria-invalid={status === "EXPIRY_NEEDED" || status === "EXPIRED"} className="field" type="date" min="0001-01-01" max="9999-12-31" disabled={disabled} value={expiryDates[requirement.id] ?? ""} onChange={(event) => onExpiry(requirement.id, event.target.value)} />
                      <p id={`${inputId}-hint`} className="mt-1.5 text-xs leading-relaxed text-slate-500">{t.expiryHint} <span className="font-medium">{data.tender.submission_deadline}</span></p>
                    </div>
                  )}
                </div>
                {file && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                  <p className="flex min-w-0 flex-1 items-start gap-1.5 break-all text-xs leading-relaxed text-slate-600"><Icon name="document" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{file.name}</span></p>
                  <button type="button" disabled={disabled} aria-label={`${t.unmatch}: ${title}`} onClick={() => onMatch(requirement.id, "")} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 transition-colors duration-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="close" className="h-3.5 w-3.5" />{t.unmatch}</button>
                </div>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
