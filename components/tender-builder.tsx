"use client";

import { useReducer, useRef, useState } from "react";
import { formatFileSize, formatNumber, formatValidationError, translations } from "@/lib/i18n";
import { MAX_PDF_FILES, MAX_TOTAL_BYTES, uploadPdfFiles } from "@/lib/pdf";
import { parseRequirementsJson } from "@/lib/requirements";
import { getReadinessSummary } from "@/lib/status";
import type { Language, ValidationError } from "@/lib/types";
import { initialWorkspace, workspaceReducer } from "@/lib/workspace";
import { FilePicker } from "./file-picker";
import { Icon } from "./icon";
import { PackageReadiness } from "./package-readiness";
import { RequirementList } from "./requirement-list";
import { TenderSummary } from "./tender-summary";
import { UploadedFiles } from "./uploaded-files";

type JsonLoadError =
  | { type: "file"; code: "notJson" | "jsonReadFailed" }
  | { type: "validation"; details: ValidationError };

export function TenderBuilder() {
  const [language, setLanguage] = useState<Language>("en");
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspace);
  const [jsonError, setJsonError] = useState<JsonLoadError | null>(null);
  const [jsonFilename, setJsonFilename] = useState("");
  const [busy, setBusy] = useState<"json" | "pdf" | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const processing = useRef(false);
  const t = translations[language];
  const disabled = busy !== null;
  const totalBytes = state.files.reduce((total, file) => total + file.size, 0);
  const summary = getReadinessSummary(state.data, state.files, state.matches, state.expiryDates);
  const jsonErrorMessage = jsonError?.type === "validation"
    ? formatValidationError(jsonError.details, language)
    : jsonError ? t[jsonError.code] : null;

  async function loadJson(files: File[]) {
    if (processing.current) return;
    const file = files[0];
    if (!file) return;
    if (!/\.json$/i.test(file.name) || (file.type !== "" && !["application/json", "text/json", "text/plain", "application/octet-stream"].includes(file.type))) {
      setJsonError({ type: "file", code: "notJson" });
      return;
    }
    processing.current = true;
    setBusy("json");
    setJsonError(null);
    try {
      const result = parseRequirementsJson(await file.text());
      if (!result.ok) {
        setJsonError({ type: "validation", details: result });
        return;
      }
      dispatch({ type: "load-tender", data: result.value });
      setJsonFilename(file.name);
    } catch {
      setJsonError({ type: "file", code: "jsonReadFailed" });
    } finally {
      processing.current = false;
      setBusy(null);
    }
  }

  async function loadPdfs(files: File[]) {
    if (processing.current) return;
    processing.current = true;
    setBusy("pdf");
    setProgress({ completed: 0, total: files.length });
    try {
      const result = await uploadPdfFiles(files, state.files, (completed, total) => setProgress({ completed, total }));
      dispatch({ type: "add-files", files: result.files, errors: result.errors });
    } finally {
      processing.current = false;
      setBusy(null);
    }
  }

  return (
    <div lang={language} className="min-h-screen">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <a href="#main" className="flex min-w-0 items-center gap-2 rounded-lg sm:gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-800 text-white sm:h-10 sm:w-10"><Icon name="document" className="h-5 w-5 sm:h-6 sm:w-6" /></span>
            <div className="min-w-0"><p className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">{t.product}</p><p className="hidden text-xs text-slate-500 sm:block">{t.productSubtitle}</p></div>
          </a>
          <div className="flex shrink-0 items-center gap-5">
            <span className="hidden items-center gap-1.5 text-xs text-slate-500 md:inline-flex"><Icon name="shield" className="h-4 w-4 text-emerald-700" />{t.localOnly}</span>
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Language / ভাষা">
              {(["en", "bn"] as const).map((value) => <button key={value} type="button" lang={value} aria-pressed={language === value} onClick={() => setLanguage(value)} className={`min-h-8 rounded-md px-2 py-1.5 text-xs font-medium transition sm:px-3 ${language === value ? "bg-white text-emerald-800 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>{value === "en" ? "EN" : "বাংলা"}</button>)}
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{t.workspace}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">{t.introduction}</p>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-800 md:hidden"><Icon name="shield" className="h-4 w-4" />{t.localOnly}</p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            <section className="panel p-4 sm:p-5" aria-labelledby="tender-heading">
              <div className="section-heading"><span className="step-number">01</span><div><h2 id="tender-heading">{t.stepOne}</h2><p>{t.stepOneHint}</p></div></div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <FilePicker id="json-upload" accept=".json,application/json" label={busy === "json" ? t.readingJson : state.data ? t.replaceJson : t.loadJson} disabled={disabled} onFiles={(files) => { void loadJson(files); }} secondary />
                <p className="text-xs text-slate-500">{t.jsonFormat}</p>
              </div>
              {jsonErrorMessage && <div role="alert" className="error-box mt-4"><p className="font-semibold">{t.jsonError}</p><p className="mt-1 break-words">{jsonErrorMessage}</p></div>}
              {state.data && <><p className="mt-4 flex items-center gap-1.5 break-all text-xs text-emerald-700"><Icon name="check" className="h-4 w-4 shrink-0" />{t.jsonLoaded} · {jsonFilename}</p><TenderSummary tender={state.data.tender} t={t} /></>}
            </section>

            <section className="panel overflow-hidden" aria-labelledby="checklist-heading" aria-busy={disabled}>
              <div className="border-b border-slate-100 p-4 sm:p-5">
                <h2 id="checklist-heading" className="text-base font-semibold text-slate-900">{t.checklist}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{t.checklistHint}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{t.assignmentHint}</p>
                {state.data && <p className="mt-3 text-xs font-medium text-emerald-800">{t.matchingProgress.replace("{matched}", formatNumber(Object.keys(state.matches).length, language)).replace("{total}", formatNumber(summary.total, language))}</p>}
              </div>
              {state.matchingError && <p role="alert" className="error-box m-5">{t.matchingErrors[state.matchingError]}</p>}
              <RequirementList data={state.data} files={state.files} matches={state.matches} expiryDates={state.expiryDates} language={language} t={t} disabled={disabled} onMatch={(requirementId, fileId) => dispatch({ type: "match", requirementId, fileId })} onExpiry={(requirementId, date) => dispatch({ type: "expiry", requirementId, date })} />
            </section>
          </div>

          <div className="min-w-0 space-y-6">
            <section className="panel p-4 sm:p-5" aria-labelledby="upload-heading" aria-busy={busy === "pdf"}>
              <div className="section-heading"><span className="step-number">02</span><div><h2 id="upload-heading">{t.stepTwo}</h2><p>{t.stepTwoHint}</p></div></div>
              <div className="mt-5 flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-6 text-center">
                <span className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-emerald-800"><Icon name="upload" className="h-6 w-6" /></span>
                <FilePicker id="pdf-upload" accept=".pdf,application/pdf" label={t.choosePdfs} disabled={disabled} multiple onFiles={(files) => { void loadPdfs(files); }} />
                <p className="mt-3 text-xs font-medium text-slate-600">{t.uploadHint}</p>
                <p className="mt-2 max-w-64 text-xs leading-relaxed text-slate-500">{t.uploadSubhint}</p>
              </div>
              {busy === "pdf" && <div role="status" className="mt-4 text-xs text-emerald-800"><p>{t.checkingFiles} · {formatNumber(progress.completed, language)} / {formatNumber(progress.total, language)}</p><progress className="mt-2 h-1.5 w-full accent-emerald-700" max={progress.total || 1} value={progress.completed} /></div>}
              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500"><span>{formatNumber(state.files.length, language)} / {formatNumber(MAX_PDF_FILES, language)} {t.files}</span><span>{formatFileSize(totalBytes, language)} / {formatFileSize(MAX_TOTAL_BYTES, language)}</span></div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={t.uploadHint} aria-valuemin={0} aria-valuemax={MAX_TOTAL_BYTES} aria-valuenow={totalBytes}><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${Math.min(100, totalBytes / MAX_TOTAL_BYTES * 100)}%` }} /></div>
              {state.uploadErrors.length > 0 && <div role="alert" className="error-box mt-4"><div className="flex items-start justify-between gap-3"><p className="font-semibold">{t.fileErrors}</p><button type="button" aria-label={t.dismiss} onClick={() => dispatch({ type: "dismiss-upload-errors" })} className="rounded p-0.5"><Icon name="close" className="h-4 w-4" /></button></div><ul className="mt-2 space-y-2">{state.uploadErrors.map((error, index) => <li key={`${error.filename}-${index}`}><span className="break-all font-medium">{error.filename}</span><p className="mt-0.5">{t.pdfErrors[error.code]}</p></li>)}</ul></div>}
            </section>

            <PackageReadiness summary={summary} hasTender={state.data !== null} disabled={disabled} language={language} t={t} />

            <section className="panel overflow-hidden" aria-labelledby="files-heading">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6"><h2 id="files-heading" className="text-sm font-semibold text-slate-900">{t.uploadedFiles}</h2><span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{formatNumber(state.files.length, language)}</span></div>
              <UploadedFiles files={state.files} matches={state.matches} requirements={state.data?.requirements ?? []} language={language} t={t} disabled={disabled} onRemove={(fileId) => dispatch({ type: "remove-file", fileId })} />
            </section>
          </div>
        </div>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-5 text-xs text-slate-400"><span>{t.product}</span><span>{t.footer}</span></footer>
      </main>
    </div>
  );
}
