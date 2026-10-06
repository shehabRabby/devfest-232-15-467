import type { DocumentMatches, FileAssignment, MatchingResult, TenderRequirement, UploadedPdf } from "./types";

/** Find the owner of a file's contents, optionally excluding the row being edited. */
export function getFileAssignment(
  file: UploadedPdf,
  matches: DocumentMatches,
  files: readonly UploadedPdf[],
  exceptRequirementId?: string,
): FileAssignment | null {
  for (const [requirementId, matchedId] of Object.entries(matches)) {
    if (requirementId === exceptRequirementId) continue;
    const matchedFile = files.find((candidate) => candidate.id === matchedId);
    if (matchedId === file.id || matchedFile?.sha256 === file.sha256) {
      return { requirementId, isDuplicate: matchedId !== file.id };
    }
  }
  return null;
}

export function getDuplicateFileIds(files: readonly UploadedPdf[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.sha256, (counts.get(file.sha256) ?? 0) + 1);
  return new Set(files.filter((file) => (counts.get(file.sha256) ?? 0) > 1).map((file) => file.id));
}

export function unassignRequirement(matches: DocumentMatches, requirementId: string): DocumentMatches {
  return Object.fromEntries(Object.entries(matches).filter(([id]) => id !== requirementId));
}

export function removeFileMatches(matches: DocumentMatches, fileId: string): DocumentMatches {
  return Object.fromEntries(Object.entries(matches).filter(([, id]) => id !== fileId));
}

/** Replace a requirement's match atomically, retaining the old match on failure. */
export function assignDocument(
  matches: DocumentMatches,
  requirementId: string,
  fileId: string,
  requirements: readonly TenderRequirement[],
  files: readonly UploadedPdf[],
): MatchingResult {
  if (!requirements.some((requirement) => requirement.id === requirementId)) {
    return { ok: false, code: "UNKNOWN_REQUIREMENT" };
  }
  const file = files.find((candidate) => candidate.id === fileId);
  if (!file) return { ok: false, code: "UNKNOWN_FILE" };
  for (const [id, matchedId] of Object.entries(matches)) {
    if (id === requirementId) continue;
    if (matchedId === fileId) return { ok: false, code: "FILE_IN_USE" };
    const matchedFile = files.find((candidate) => candidate.id === matchedId);
    if (matchedFile?.sha256 === file.sha256) return { ok: false, code: "DUPLICATE_IN_USE" };
  }
  return { ok: true, matches: { ...matches, [requirementId]: fileId } };
}

export function hasValidMatches(
  requirements: readonly TenderRequirement[],
  files: readonly UploadedPdf[],
  matches: DocumentMatches,
): boolean {
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const usedFileIds = new Set<string>();
  const usedHashes = new Set<string>();
  for (const [requirementId, fileId] of Object.entries(matches)) {
    const file = files.find((candidate) => candidate.id === fileId);
    if (!requirementIds.has(requirementId) || !file || usedFileIds.has(fileId) || usedHashes.has(file.sha256)) {
      return false;
    }
    usedFileIds.add(fileId);
    usedHashes.add(file.sha256);
  }
  return true;
}
