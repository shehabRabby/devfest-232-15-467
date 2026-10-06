"use client";

import { useReducer, useRef, useState } from "react";
import Image from "next/image";
import companyLogo from "@/documents/company_logo.png";
import { formatFileSize, formatNumber, formatValidationError, translations } from "@/lib/i18n";
import { MAX_PDF_FILES, MAX_TOTAL_BYTES, uploadPdfFiles } from "@/lib/pdf";
import { downloadPackagePdf, generatePackagePdf, PackagePdfError, type GenerationFeedback, type PackageProgress } from "@/lib/package-pdf";
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
  const [busy, setBusy] = useState<"json" | "pdf" | "package" | null>(null);
  const [generationFeedback, setGenerationFeedback] = useState<GenerationFeedback | null>(null);
  const [packageProgress, setPackageProgress] = useState<PackageProgress | null>(null);
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
      setGenerationFeedback(null);
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

  async function generatePackage() {
    if (processing.current || !summary.canGenerate) return;
    processing.current = true;
    setBusy("package");
    setGenerationFeedback(null);
    setPackageProgress(null);
    try {
      const result = await generatePackagePdf(state.data, state.files, state.matches, state.expiryDates, setPackageProgress);
      downloadPackagePdf(result);
      setGenerationFeedback({ type: "success", filename: result.filename });
    } catch (error: unknown) {
      const failure = error instanceof PackagePdfError ? error : new PackagePdfError("GENERATION_FAILED");
      setGenerationFeedback({ type: "error", code: failure.code, filename: failure.filename });
    } finally {
      processing.current = false;
      setBusy(null);
    }
  }

  return (
    <div lang={language} className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <a href="#main" className="flex min-w-0 items-center gap-3 rounded-lg">
            <Image src={companyLogo} alt={t.companyLogoAlt} width={48} height={48} sizes="48px" priority className="h-12 w-12 shrink-0 rounded-xl object-contain" />
            <div className="min-w-0"><p className="break-words text-base font-semibold leading-snug tracking-tight text-slate-900 sm:text-lg">{t.appTitle}</p><p className="mt-1 hidden text-xs leading-relaxed text-slate-500 md:block">{t.appSubtitle}</p></div>
          </a>
          <div className="flex shrink-0 items-center gap-5">
            <span className="hidden items-center gap-1.5 text-xs text-slate-600 xl:inline-flex"><Icon name="shield" className="h-4 w-4 text-cyan-800" />{t.localOnly}</span>
            <div className="flex rounded-xl border border-slate-200 bg-slate-100/80 p-1" role="group" aria-label="Language / ভাষা">
              {(["en", "bn"] as const).map((value) => <button key={value} type="button" lang={value} aria-pressed={language === value} onClick={() => setLanguage(value)} className={`min-h-11 min-w-12 rounded-lg px-3 py-2 text-xs font-semibold transition-colors duration-200 ${language === value ? "bg-cyan-900 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-900"}`}>{value === "en" ? "EN" : "বাংলা"}</button>)}
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t.workspace}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">{t.introduction}</p>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-cyan-900 xl:hidden"><Icon name="shield" className="h-4 w-4 shrink-0" />{t.localOnly}</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
            <section className="panel p-4 sm:p-6" aria-labelledby="tender-heading">
              <div className="section-heading"><span className="step-number">01</span><div><h2 id="tender-heading">{t.stepOne}</h2><p>{t.stepOneHint}</p></div></div>
              <div className="upload-zone mt-5 min-h-48">
                <span className="mb-3 rounded-xl border border-slate-200 bg-white p-2.5 text-cyan-900"><Icon name="document" className="h-5 w-5" /></span>
                <FilePicker id="json-upload" accept=".json,application/json" label={busy === "json" ? t.readingJson : state.data ? t.replaceJson : t.loadJson} disabled={disabled} onFiles={(files) => { void loadJson(files); }} secondary />
                <p className="mt-3 text-xs leading-relaxed text-slate-600">{t.jsonFormat}</p>
              </div>
              {jsonErrorMessage && <div role="alert" className="error-box mt-4"><p className="font-semibold">{t.jsonError}</p><p className="mt-1 break-words">{jsonErrorMessage}</p></div>}
              {state.data && <p className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-xs leading-relaxed text-emerald-800"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-all">{t.jsonLoaded} · {jsonFilename}</span></p>}
            </section>
            <section className="panel p-4 sm:p-6" aria-labelledby="upload-heading" aria-busy={busy === "pdf"}>
              <div className="section-heading"><span className="step-number">02</span><div><h2 id="upload-heading">{t.stepTwo}</h2><p>{t.stepTwoHint}</p></div></div>
              <div className="upload-zone mt-5 min-h-48">
                <span className="mb-3 rounded-xl border border-slate-200 bg-white p-2.5 text-cyan-900"><Icon name="upload" className="h-5 w-5" /></span>
                <FilePicker id="pdf-upload" accept=".pdf,application/pdf" label={t.choosePdfs} disabled={disabled} multiple onFiles={(files) => { void loadPdfs(files); }} />
                <p className="mt-3 text-xs font-medium text-slate-600">{t.uploadHint}</p>
                <p className="mt-2 max-w-64 text-xs leading-relaxed text-slate-500">{t.uploadSubhint}</p>
              </div>
              {busy === "pdf" && <div role="status" className="mt-4 text-xs text-emerald-800"><p>{t.checkingFiles} · {formatNumber(progress.completed, language)} / {formatNumber(progress.total, language)}</p><progress className="mt-2 h-1.5 w-full accent-emerald-700" max={progress.total || 1} value={progress.completed} /></div>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-slate-600"><span>{formatNumber(state.files.length, language)} / {formatNumber(MAX_PDF_FILES, language)} {t.files}</span><span>{formatFileSize(totalBytes, language)} / {formatFileSize(MAX_TOTAL_BYTES, language)}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={t.uploadHint} aria-valuemin={0} aria-valuemax={MAX_TOTAL_BYTES} aria-valuenow={totalBytes}><div className="h-full rounded-full bg-cyan-800 transition-[width] duration-200" style={{ width: `${Math.min(100, totalBytes / MAX_TOTAL_BYTES * 100)}%` }} /></div>
              {state.uploadErrors.length > 0 && <div role="alert" className="error-box mt-4"><div className="flex items-start justify-between gap-3"><p className="font-semibold">{t.fileErrors}</p><button type="button" aria-label={t.dismiss} onClick={() => dispatch({ type: "dismiss-upload-errors" })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-red-100"><Icon name="close" className="h-4 w-4" /></button></div><ul className="mt-2 space-y-2">{state.uploadErrors.map((error, index) => <li key={`${error.filename}-${index}`}><span className="break-all font-medium">{error.filename}</span><p className="mt-0.5">{t.pdfErrors[error.code]}</p></li>)}</ul></div>}
            </section>
        </div>

        {state.data && <TenderSummary tender={state.data.tender} t={t} />}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
            <section className="panel order-2 overflow-hidden lg:order-1" aria-labelledby="checklist-heading" aria-busy={disabled}>
              <div className="border-b border-slate-200 bg-slate-50/40 p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="checklist-heading" className="text-base font-semibold text-slate-900">{t.checklist}</h2>
                  {state.data && <p className="rounded-md border border-cyan-100 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-900">{t.matchingProgress.replace("{matched}", formatNumber(Object.keys(state.matches).length, language)).replace("{total}", formatNumber(summary.total, language))}</p>}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{t.checklistHint}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{t.assignmentHint}</p>
              </div>
              {state.matchingError && <p role="alert" className="error-box m-5">{t.matchingErrors[state.matchingError]}</p>}
              <RequirementList data={state.data} files={state.files} matches={state.matches} expiryDates={state.expiryDates} language={language} t={t} disabled={disabled} onMatch={(requirementId, fileId) => dispatch({ type: "match", requirementId, fileId })} onExpiry={(requirementId, date) => dispatch({ type: "expiry", requirementId, date })} />
            </section>

          <div className="contents lg:order-2 lg:block lg:min-w-0 lg:space-y-5">
            <div className="order-1 min-w-0">
            <PackageReadiness summary={summary} hasTender={state.data !== null} disabled={disabled} generating={busy === "package"} progress={packageProgress} feedback={generationFeedback} onGenerate={() => { void generatePackage(); }} language={language} t={t} />
            </div>

            <section className="panel order-3 overflow-hidden" aria-labelledby="files-heading">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/40 px-4 py-4 sm:px-6"><h2 id="files-heading" className="text-base font-semibold text-slate-900">{t.uploadedFiles}</h2><span className="flex h-7 min-w-7 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold tabular-nums text-slate-600">{formatNumber(state.files.length, language)}</span></div>
              <UploadedFiles files={state.files} matches={state.matches} requirements={state.data?.requirements ?? []} language={language} t={t} disabled={disabled} onRemove={(fileId) => dispatch({ type: "remove-file", fileId })} />
            </section>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500"><span>{t.product}</span><span>{t.footer}</span></footer>
      </main>
    </div>
  );
}
