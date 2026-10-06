export interface Tender {
  tender_id: string;
  title: string;
  procuring_entity: string;
  bidder: string;
  submission_deadline: string;
}

export interface TenderRequirement {
  id: string;
  order: number;
  title_en: string;
  title_bn: string;
  mandatory: boolean;
  has_expiry: boolean;
}

export interface TenderData {
  tender: Tender;
  requirements: TenderRequirement[];
}

export interface UploadedPdf {
  id: string;
  name: string;
  size: number;
  pageCount: number;
  sha256: string;
  bytes: Uint8Array;
}

/** Requirement ID → file ID. Missing keys represent unmatched requirements. */
export type DocumentMatches = Readonly<Record<string, string>>;

/** Requirement ID → ISO calendar date, or an empty string when not supplied. */
export type ExpiryDateState = Readonly<Record<string, string>>;

export type DocumentStatus =
  | "MISSING"
  | "EXPIRY_NEEDED"
  | "EXPIRED"
  | "NOT_PROVIDED"
  | "OK";

export type Language = "en" | "bn";

export type ValidationErrorCode =
  | "INVALID_STRUCTURE"
  | "REQUIRED_STRING"
  | "INVALID_DEADLINE"
  | "INVALID_REQUIREMENT"
  | "INVALID_ORDER"
  | "INVALID_FLAGS"
  | "DUPLICATE_ID"
  | "MALFORMED_JSON";

export interface ValidationError {
  error: string;
  code: ValidationErrorCode;
  path?: string;
  requirementId?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | ({ ok: false } & ValidationError);

export interface ReadinessSummary {
  total: number;
  ok: number;
  blocking: number;
  notProvided: number;
  statusCounts: Readonly<Record<DocumentStatus, number>>;
  canGenerate: boolean;
}

export interface FileAssignment {
  requirementId: string;
  isDuplicate: boolean;
}

export type MatchingErrorCode =
  | "UNKNOWN_REQUIREMENT"
  | "UNKNOWN_FILE"
  | "FILE_IN_USE"
  | "DUPLICATE_IN_USE";

export type MatchingResult =
  | { ok: true; matches: DocumentMatches }
  | { ok: false; code: MatchingErrorCode };

export type PdfErrorCode =
  | "NOT_PDF"
  | "TOO_MANY_FILES"
  | "TOTAL_TOO_LARGE"
  | "EMPTY_FILE"
  | "READ_FAILED"
  | "INVALID_PDF"
  | "ENCRYPTED_PDF"
  | "HASH_UNAVAILABLE";

export interface PdfUploadError {
  filename: string;
  code: PdfErrorCode;
}

export interface PdfUploadResult {
  files: UploadedPdf[];
  errors: PdfUploadError[];
}
