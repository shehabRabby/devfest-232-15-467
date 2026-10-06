import { compareIsoDates, isValidIsoDate } from "./dates";
import { hasValidMatches } from "./matching";
import type { DocumentMatches, DocumentStatus, ExpiryDateState, ReadinessSummary, TenderData, TenderRequirement, UploadedPdf } from "./types";

export function getRequirementStatus(
  requirement: TenderRequirement,
  matchedFile: UploadedPdf | undefined,
  expiryDate: string | undefined,
  submissionDeadline: string,
): DocumentStatus {
  if (!matchedFile) return requirement.mandatory ? "MISSING" : "NOT_PROVIDED";
  if (!requirement.has_expiry) return "OK";
  if (!expiryDate || !isValidIsoDate(expiryDate)) return "EXPIRY_NEEDED";
  return compareIsoDates(expiryDate, submissionDeadline) < 0 ? "EXPIRED" : "OK";
}

export function isBlockingStatus(status: DocumentStatus): boolean {
  return status === "MISSING" || status === "EXPIRY_NEEDED" || status === "EXPIRED";
}

/** A single readiness gate shared by the interface and PDF generator. */
export function canGeneratePackage(
  data: TenderData | null,
  files: readonly UploadedPdf[],
  matches: DocumentMatches,
  expiryDates: ExpiryDateState,
): boolean {
  if (!data || data.requirements.length === 0 || !isValidIsoDate(data.tender.submission_deadline)) return false;
  if (!hasValidMatches(data.requirements, files, matches)) return false;
  return data.requirements.every((requirement) => {
    const file = files.find((candidate) => candidate.id === matches[requirement.id]);
    return !isBlockingStatus(getRequirementStatus(requirement, file, expiryDates[requirement.id], data.tender.submission_deadline));
  });
}

/** Derive every summary count from the same status engine used by the checklist. */
export function getReadinessSummary(
  data: TenderData | null,
  files: readonly UploadedPdf[],
  matches: DocumentMatches,
  expiryDates: ExpiryDateState,
): ReadinessSummary {
  const statusCounts: Record<DocumentStatus, number> = { MISSING: 0, EXPIRY_NEEDED: 0, EXPIRED: 0, NOT_PROVIDED: 0, OK: 0 };
  if (data) {
    for (const requirement of data.requirements) {
      const file = files.find((candidate) => candidate.id === matches[requirement.id]);
      const status = getRequirementStatus(requirement, file, expiryDates[requirement.id], data.tender.submission_deadline);
      statusCounts[status] += 1;
    }
  }
  const blocking = (Object.keys(statusCounts) as DocumentStatus[])
    .filter(isBlockingStatus)
    .reduce((count, status) => count + statusCounts[status], 0);
  return {
    total: data?.requirements.length ?? 0,
    ok: statusCounts.OK,
    blocking,
    notProvided: statusCounts.NOT_PROVIDED,
    statusCounts,
    canGenerate: canGeneratePackage(data, files, matches, expiryDates),
  };
}
