import { compareIsoDates, isValidIsoDate } from "./dates";
import { hasValidMatches } from "./matching";
import type { DocumentMatches, DocumentStatus, ExpiryDateState, TenderData, TenderRequirement, UploadedPdf } from "./types";

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

/** Readiness only; package generation is intentionally deferred to a later stage. */
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
