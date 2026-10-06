import { PDFDocument } from "pdf-lib";
import { sha256 } from "./hash";
import type { PdfErrorCode, PdfUploadResult, UploadedPdf } from "./types";

export const MAX_PDF_FILES = 30;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export function isPdfFile(file: Pick<File, "name" | "type">): boolean {
  return /\.pdf$/i.test(file.name) && (file.type === "application/pdf" || file.type === "" || file.type === "application/octet-stream");
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  // PDF headers can occur within the first 1024 bytes of a file.
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return /%PDF-\d\.\d/.test(header);
}

export async function loadPdfFile(file: File): Promise<UploadedPdf> {
  if (!isPdfFile(file)) throw new Error("NOT_PDF");
  if (file.size === 0) throw new Error("EMPTY_FILE");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error("READ_FAILED");
  }
  if (!hasPdfHeader(bytes)) throw new Error("INVALID_PDF");
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
    if (document.isEncrypted) throw new Error("ENCRYPTED_PDF");
    if (document.getPageCount() < 1) throw new Error("INVALID_PDF");
    // Resolve page objects now so damaged page trees fail before entering state.
    document.getPages();
  } catch (error: unknown) {
    const detail = error instanceof Error ? `${error.name} ${error.message}` : "";
    throw new Error(/encrypt|password/i.test(detail) ? "ENCRYPTED_PDF" : "INVALID_PDF");
  }
  let hash: string;
  try {
    hash = await sha256(bytes);
  } catch {
    throw new Error("HASH_UNAVAILABLE");
  }
  return { id: globalThis.crypto.randomUUID(), name: file.name, size: file.size, pageCount: document.getPageCount(), sha256: hash, bytes };
}

const knownErrors: readonly PdfErrorCode[] = ["NOT_PDF", "TOO_MANY_FILES", "TOTAL_TOO_LARGE", "EMPTY_FILE", "READ_FAILED", "INVALID_PDF", "ENCRYPTED_PDF", "HASH_UNAVAILABLE"];

/** Process sequentially to bound memory; failed files consume no upload quota. */
export async function uploadPdfFiles(
  selected: readonly File[],
  existing: readonly UploadedPdf[],
  onProgress?: (completed: number, total: number) => void,
): Promise<PdfUploadResult> {
  const result: PdfUploadResult = { files: [], errors: [] };
  let totalBytes = existing.reduce((total, file) => total + file.size, 0);
  for (const [index, file] of selected.entries()) {
    let errorCode: PdfErrorCode | undefined;
    if (!isPdfFile(file)) errorCode = "NOT_PDF";
    else if (existing.length + result.files.length >= MAX_PDF_FILES) errorCode = "TOO_MANY_FILES";
    else if (totalBytes + file.size > MAX_TOTAL_BYTES) errorCode = "TOTAL_TOO_LARGE";
    if (errorCode) {
      result.errors.push({ filename: file.name, code: errorCode });
    } else {
      try {
        const uploaded = await loadPdfFile(file);
        result.files.push(uploaded);
        totalBytes += uploaded.size;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "INVALID_PDF";
        const code = knownErrors.find((candidate) => candidate === message) ?? "INVALID_PDF";
        result.errors.push({ filename: file.name, code });
      }
    }
    onProgress?.(index + 1, selected.length);
  }
  return result;
}
