import { formatFileSize, formatNumber, type TranslationDictionary } from "@/lib/i18n";
import { getDuplicateFileIds, getFileAssignment } from "@/lib/matching";
import type { DocumentMatches, Language, TenderRequirement, UploadedPdf } from "@/lib/types";
import { Icon } from "./icon";

interface UploadedFilesProps {
  files: readonly UploadedPdf[];
  matches: DocumentMatches;
  requirements: readonly TenderRequirement[];
  language: Language;
  t: TranslationDictionary;
  disabled: boolean;
  onRemove: (fileId: string) => void;
}

export function UploadedFiles({ files, matches, requirements, language, t, disabled, onRemove }: UploadedFilesProps) {
  if (files.length === 0) return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name="folder" className="h-7 w-7" /></span>
      <h3>{t.noFiles}</h3>
      <p>{t.noFilesHint}</p>
    </div>
  );
  const duplicates = getDuplicateFileIds(files);
  const matchedIds = new Set(Object.values(matches));
  return (
    <>
    {duplicates.size > 0 && <p className="border-b border-amber-100 bg-amber-50/60 px-4 py-3 text-xs leading-relaxed text-amber-900 sm:px-5">{t.duplicateExplanation}</p>}
    <ul className="divide-y divide-slate-100">
      {files.map((file) => {
        const assignment = getFileAssignment(file, matches, files);
        const owner = requirements.find((item) => item.id === assignment?.requirementId);
        const ownerTitle = owner ? language === "bn" ? owner.title_bn : owner.title_en : assignment?.requirementId;
        return (
        <li key={file.id} className="flex items-start gap-3 px-4 py-4 sm:px-5">
          <span className="mt-0.5 rounded-lg bg-slate-50 p-2.5 text-slate-500"><Icon name="document" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="break-all text-sm font-medium text-slate-800">{file.name}</p>
            <p className="mt-1 text-xs text-slate-500">{formatNumber(file.pageCount, language)} {file.pageCount === 1 ? t.page : t.pages} <span aria-hidden="true">·</span> {formatFileSize(file.size, language)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {duplicates.has(file.id) && <span title={t.duplicateHint} className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">{t.duplicate}</span>}
              {matchedIds.has(file.id) && <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{t.assigned}</span>}
            </div>
            {assignment && <p className="mt-1.5 break-words text-xs leading-relaxed text-slate-500">{assignment.isDuplicate ? t.sameContentAssignedTo : t.assignedTo}: <span className="font-medium text-slate-600">{ownerTitle}</span></p>}
          </div>
          <button type="button" onClick={() => onRemove(file.id)} disabled={disabled} aria-label={`${t.remove}: ${file.name}`} title={t.remove} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </li>
      ); })}
    </ul>
    </>
  );
}
