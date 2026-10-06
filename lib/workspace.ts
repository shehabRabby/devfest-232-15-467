import { assignDocument, removeFileMatches, unassignRequirement } from "./matching";
import type { DocumentMatches, ExpiryDateState, MatchingErrorCode, PdfUploadError, TenderData, UploadedPdf } from "./types";

export interface WorkspaceState {
  data: TenderData | null;
  files: UploadedPdf[];
  matches: DocumentMatches;
  expiryDates: ExpiryDateState;
  uploadErrors: PdfUploadError[];
  matchingError: MatchingErrorCode | null;
}

export const initialWorkspace: WorkspaceState = {
  data: null,
  files: [],
  matches: {},
  expiryDates: {},
  uploadErrors: [],
  matchingError: null,
};

export type WorkspaceAction =
  | { type: "load-tender"; data: TenderData }
  | { type: "add-files"; files: UploadedPdf[]; errors: PdfUploadError[] }
  | { type: "remove-file"; fileId: string }
  | { type: "match"; requirementId: string; fileId: string }
  | { type: "expiry"; requirementId: string; date: string }
  | { type: "dismiss-upload-errors" };

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "load-tender":
      return { ...state, data: action.data, matches: {}, expiryDates: {}, matchingError: null };
    case "add-files":
      return { ...state, files: [...state.files, ...action.files], uploadErrors: action.errors };
    case "remove-file": {
      const clearedRequirementIds = new Set(Object.entries(state.matches).filter(([, fileId]) => fileId === action.fileId).map(([id]) => id));
      return {
        ...state,
        files: state.files.filter((file) => file.id !== action.fileId),
        matches: removeFileMatches(state.matches, action.fileId),
        expiryDates: Object.fromEntries(Object.entries(state.expiryDates).filter(([id]) => !clearedRequirementIds.has(id))),
        matchingError: null,
      };
    }
    case "match": {
      if (!state.data) return state;
      const result = action.fileId
        ? assignDocument(state.matches, action.requirementId, action.fileId, state.data.requirements, state.files)
        : { ok: true as const, matches: unassignRequirement(state.matches, action.requirementId) };
      if (!result.ok) return { ...state, matchingError: result.code };
      const expiryDates = state.matches[action.requirementId] === action.fileId
        ? state.expiryDates
        : Object.fromEntries(Object.entries(state.expiryDates).filter(([id]) => id !== action.requirementId));
      return { ...state, matches: result.matches, expiryDates, matchingError: null };
    }
    case "expiry": {
      const requirement = state.data?.requirements.find((item) => item.id === action.requirementId);
      if (!requirement?.has_expiry || !state.matches[action.requirementId]) return state;
      return { ...state, expiryDates: { ...state.expiryDates, [action.requirementId]: action.date } };
    }
    case "dismiss-upload-errors":
      return { ...state, uploadErrors: [] };
  }
}
