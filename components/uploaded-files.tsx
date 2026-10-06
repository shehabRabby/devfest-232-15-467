import { formatFileSize, formatNumber, type TranslationDictionary } from "@/lib/i18n";
import { getDuplicateFileIds } from "@/lib/matching";
import type { DocumentMatches, Language, UploadedPdf } from "@/lib/types";
import { Icon } from "./icon";

interface UploadedFilesProps {
  files: readonly UploadedPdf[];
  matches: DocumentMatches;
  language: Language;
  t: TranslationDictionary;
  disabled: boolean;
  onRemove: (fileId: string) => void;
}

export function UploadedFiles({ files, matches, language, t, disabled, onRemove }: UploadedFilesProps) {
  if (files.length === 0) return (
    <div className="empty-state py-12">
      <span className="empty-icon"><Icon name="folder" className="h-7 w-7" /></span>
      <h3>{t.noFiles}</h3>
      <p>{t.noFilesHint}</p>
    </div>
  );
  const duplicates = getDuplicateFileIds(files);
  const matchedIds = new Set(Object.values(matches));
  return (
    <ul className="divide-y divide-slate-100">
      {files.map((file) => (
        <li key={file.id} className="flex items-start gap-3 px-5 py-4 sm:px-6">
          <span className="mt-0.5 rounded-lg bg-slate-50 p-2.5 text-slate-500"><Icon name="document" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="break-all text-sm font-medium text-slate-800">{file.name}</p>
            <p className="mt-1 text-xs text-slate-500">{formatNumber(file.pageCount, language)} {file.pageCount === 1 ? t.page : t.pages} <span aria-hidden="true">·</span> {formatFileSize(file.size, language)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {duplicates.has(file.id) && <span title={t.duplicateHint} className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">{t.duplicate}</span>}
              {matchedIds.has(file.id) && <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{t.assigned}</span>}
            </div>
          </div>
          <button type="button" onClick={() => onRemove(file.id)} disabled={disabled} aria-label={`${t.remove}: ${file.name}`} title={t.remove} className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
