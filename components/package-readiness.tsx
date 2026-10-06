"use client";

import { formatNumber, type TranslationDictionary } from "@/lib/i18n";
import type { GenerationFeedback, PackageProgress } from "@/lib/package-pdf";
import { isBlockingStatus } from "@/lib/status";
import type { DocumentStatus, Language, ReadinessSummary } from "@/lib/types";
import { Icon } from "./icon";

interface PackageReadinessProps {
  summary: ReadinessSummary;
  hasTender: boolean;
  disabled: boolean;
  generating: boolean;
  progress: PackageProgress | null;
  feedback: GenerationFeedback | null;
  onGenerate: () => void;
  language: Language;
  t: TranslationDictionary;
}

export function PackageReadiness({ summary, hasTender, disabled, generating, progress, feedback, onGenerate, language, t }: PackageReadinessProps) {
  const ready = summary.canGenerate;
  const message = ready ? t.readyHint
    : !hasTender ? t.startHint
    : summary.total === 0 ? t.noRequirements
    : summary.blocking > 0
      ? (summary.blocking === 1 ? t.blockingHintSingle : t.blockingHint).replace("{count}", formatNumber(summary.blocking, language))
      : t.assignmentReview;
  const counts = [
    { id: "total", value: summary.total, label: t.requirements },
    { id: "ok", value: summary.ok, label: t.okCount },
    { id: "blocking", value: summary.blocking, label: t.blocking },
    { id: "not-provided", value: summary.notProvided, label: t.notProvidedCount },
  ];
  const blockingStatuses = (Object.keys(summary.statusCounts) as DocumentStatus[]).filter(isBlockingStatus);

  return (
    <section className="panel p-4 sm:p-6" aria-labelledby="readiness-heading">
      <h2 id="readiness-heading" className="text-base font-semibold text-slate-900">{t.packageReadiness}</h2>
      <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
        {counts.map(({ id, value, label }) => (
          <div key={id} className={`min-w-0 rounded-xl border px-3 py-3 ${id === "blocking" && value > 0 ? "border-red-200 bg-red-50" : id === "ok" ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-slate-50"}`}>
            <dt className={`min-h-8 break-words text-xs font-medium leading-relaxed ${id === "blocking" && value > 0 ? "text-red-800" : id === "ok" ? "text-emerald-800" : "text-slate-600"}`}>{label}</dt>
            <dd id={`readiness-${id}`} className={`mt-1 text-2xl font-semibold tabular-nums ${id === "blocking" && value > 0 ? "text-red-700" : id === "ok" && value > 0 ? "text-emerald-700" : "text-slate-800"}`}>{formatNumber(value, language)}</dd>
          </div>
        ))}
      </dl>
      <div role="status" className={`mt-4 flex gap-2.5 rounded-xl border p-3 ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-900" : summary.blocking > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
        <Icon name={ready ? "check" : hasTender ? "alert" : "document"} className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          {hasTender && <p className="text-sm font-semibold">{ready ? t.ready : t.review}</p>}
          <p id="readiness-message" className="mt-0.5 text-xs leading-relaxed">{message}</p>
        </div>
      </div>
      {summary.blocking > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600" aria-label={t.blocking}>
          {blockingStatuses.filter((status) => summary.statusCounts[status] > 0).map((status) => (
            <li key={status}>{t.statuses[status]}: <span className="font-semibold">{formatNumber(summary.statusCounts[status], language)}</span></li>
          ))}
        </ul>
      )}
      <button id="generate-package" type="button" disabled={!ready || disabled} aria-busy={generating} aria-describedby="readiness-message export-notice" onClick={onGenerate} className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-transparent bg-cyan-900 px-3 py-3 text-sm font-semibold text-white shadow-sm transition-colors duration-200 enabled:hover:bg-cyan-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 disabled:shadow-none">
        <Icon name="document" className="h-4 w-4 shrink-0" />{generating ? t.generatingPackage : t.generatePackage}
      </button>
      <p id="export-notice" className="mt-2 text-center text-xs leading-relaxed text-slate-500">{t.generationHint}</p>
      {generating && progress && <div role="status" className="mt-3 text-xs leading-relaxed text-emerald-800">
        <p>{t.generationStages[progress.stage]} · {formatNumber(progress.completed, language)} / {formatNumber(progress.total, language)}</p>
        <progress className="mt-2 h-1.5 w-full accent-emerald-700" max={progress.total || 1} value={progress.completed} aria-label={t.generatingPackage} />
      </div>}
      {!generating && feedback?.type === "success" && <p role="status" className="mt-3 break-all text-xs leading-relaxed text-emerald-800">{t.packageDownloaded.replace("{filename}", () => feedback.filename)}</p>}
      {!generating && feedback?.type === "error" && <div role="alert" className="error-box mt-3">
        <p className="font-semibold">{t.packageGenerationError}</p>
        {feedback.filename && <p className="mt-1 break-all font-medium">{feedback.filename}</p>}
        <p className="mt-1">{t.packageErrors[feedback.code]}</p>
      </div>}
    </section>
  );
}
