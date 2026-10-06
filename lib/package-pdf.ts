import { PDFContentStream, PDFDocument, StandardFonts, clip, degrees, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { sortRequirements } from "./requirements";
import { canGeneratePackage } from "./status";
import type { DocumentMatches, ExpiryDateState, TenderData, TenderRequirement, UploadedPdf } from "./types";

export type PackageErrorCode = "NOT_READY" | "INVALID_DOCUMENT" | "UNSUPPORTED_TEXT" | "GENERATION_FAILED" | "DOWNLOAD_FAILED";

export class PackagePdfError extends Error {
  constructor(public readonly code: PackageErrorCode, public readonly filename?: string) {
    super(code);
    this.name = "PackagePdfError";
  }
}

export interface IncludedPackageDocument {
  requirement: TenderRequirement;
  file: UploadedPdf;
}

export interface PackageProgress {
  stage: "loading" | "rendering" | "saving";
  completed: number;
  total: number;
}

export interface GeneratedPackagePdf {
  bytes: Uint8Array;
  filename: string;
  pageCount: number;
  documents: readonly IncludedPackageDocument[];
}

export type GenerationFeedback =
  | { type: "success"; filename: string }
  | { type: "error"; code: PackageErrorCode; filename?: string };

export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PACKAGE_FOOTER_HEIGHT = 40;
const FOOTER_FONT_SIZE = 9;
const FOOTER_SIDE_MARGIN = 24;
const COVER_WIDTH = 595.28;
const COVER_MIN_HEIGHT = 841.89;
const COVER_MARGIN = 44;

export function getIncludedDocuments(
  data: TenderData,
  files: readonly UploadedPdf[],
  matches: DocumentMatches,
): IncludedPackageDocument[] {
  return sortRequirements(data.requirements).flatMap((requirement) => {
    const file = files.find((candidate) => candidate.id === matches[requirement.id]);
    return file ? [{ requirement, file }] : [];
  });
}

export function getPackageFilename(tenderId: string): string {
  return `${tenderId}_Package.pdf`;
}

export function formatPackageFooter(tenderId: string, page: number, total: number): string {
  if (!Number.isInteger(page) || !Number.isInteger(total) || page < 1 || page > total) {
    throw new RangeError("Invalid package page number.");
  }
  return `${tenderId} | Page ${page} of ${total}`;
}

export function formatPackageMadeDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function normalizedRotation(angle: number): number {
  const rotation = ((angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw new PackagePdfError("INVALID_DOCUMENT");
  return rotation;
}

/** Expand the visual bottom edge, keeping all original content at its original scale. */
export function getFooterSafePageBox(original: PageBox, angle: number, minimumVisualWidth = 0): PageBox {
  if (![original.x, original.y, original.width, original.height].every(Number.isFinite) || original.width <= 0 || original.height <= 0) {
    throw new PackagePdfError("INVALID_DOCUMENT");
  }
  const rotation = normalizedRotation(angle);
  const horizontal = rotation === 0 || rotation === 180;
  const extraWidth = Math.max(0, minimumVisualWidth - (horizontal ? original.width : original.height));
  switch (rotation) {
    case 90: return { x: original.x, y: original.y - extraWidth / 2, width: original.width + PACKAGE_FOOTER_HEIGHT, height: original.height + extraWidth };
    case 180: return { x: original.x - extraWidth / 2, y: original.y, width: original.width + extraWidth, height: original.height + PACKAGE_FOOTER_HEIGHT };
    case 270: return { x: original.x - PACKAGE_FOOTER_HEIGHT, y: original.y - extraWidth / 2, width: original.width + PACKAGE_FOOTER_HEIGHT, height: original.height + extraWidth };
    default: return { x: original.x - extraWidth / 2, y: original.y - PACKAGE_FOOTER_HEIGHT, width: original.width + extraWidth, height: original.height + PACKAGE_FOOTER_HEIGHT };
  }
}

/** Convert visible-page coordinates to the unrotated PDF coordinate system. */
function pagePoint(box: PageBox, rotation: number, x: number, y: number): { x: number; y: number } {
  switch (rotation) {
    case 90: return { x: box.x + box.width - y, y: box.y + x };
    case 180: return { x: box.x + box.width - x, y: box.y + box.height - y };
    case 270: return { x: box.x + y, y: box.y + box.height - x };
    default: return { x: box.x + x, y: box.y + y };
  }
}

function drawFooter(page: PDFPage, text: string, font: PDFFont): void {
  const box = page.getMediaBox();
  const rotation = normalizedRotation(page.getRotation().angle);
  const width = rotation === 90 || rotation === 270 ? box.height : box.width;
  const textWidth = font.widthOfTextAtSize(text, FOOTER_FONT_SIZE);
  const origin = pagePoint(box, rotation, (width - textWidth) / 2, 14);
  page.drawLine({
    start: pagePoint(box, rotation, FOOTER_SIDE_MARGIN, 30),
    end: pagePoint(box, rotation, width - FOOTER_SIDE_MARGIN, 30),
    thickness: 0.5, color: rgb(0.82, 0.85, 0.87),
  });
  page.drawText(text, { ...origin, font, size: FOOTER_FONT_SIZE, rotate: degrees(rotation), color: rgb(0.28, 0.32, 0.36) });
}

function isolateOriginalContent(page: PDFPage, original: PageBox): void {
  // Retain the original page boundary when expanding its box for the footer.
  // Otherwise previously off-page marks could become visible in the new band.
  page.node.normalize();
  const context = page.doc.context;
  const start = PDFContentStream.of(context.obj({}), [pushGraphicsState(), rectangle(original.x, original.y, original.width, original.height), clip(), endPath()]);
  const end = PDFContentStream.of(context.obj({}), [popGraphicsState()]);
  page.node.wrapContentStreams(context.register(start), context.register(end));
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const combined = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(combined, size) <= maxWidth) {
        line = combined;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (line && font.widthOfTextAtSize(line + character, size) > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawCover(
  output: PDFDocument,
  data: TenderData,
  documents: readonly IncludedPackageDocument[],
  madeDate: string,
  regular: PDFFont,
  bold: PDFFont,
  totalPages: number,
): void {
  const coverWidth = Math.max(COVER_WIDTH, regular.widthOfTextAtSize(formatPackageFooter(data.tender.tender_id, totalPages, totalPages), FOOTER_FONT_SIZE) + 2 * FOOTER_SIDE_MARGIN);
  const width = coverWidth - 2 * COVER_MARGIN;
  const fields = [
    ["Tender ID", data.tender.tender_id],
    ["Tender title", data.tender.title],
    ["Procuring entity", data.tender.procuring_entity],
    ["Bidder name", data.tender.bidder],
    ["Submission deadline", data.tender.submission_deadline],
    ["Date package was made", madeDate],
  ].map(([label, value]) => ({ label, lines: wrapText(value, regular, 11, width) }));
  const included = documents.length > 0
    ? documents.map(({ requirement }, index) => wrapText(`${index + 1}. ${requirement.title_en}`, regular, 10, width))
    : [["No documents included."]];
  const fieldsHeight = fields.reduce((height, field) => height + 24 + field.lines.length * 15, 0);
  const listHeight = included.reduce((height, lines) => height + lines.length * 14 + 6, 0);
  // Keep exactly one cover, making it taller when a long ordered list needs space.
  const height = Math.max(COVER_MIN_HEIGHT, 150 + fieldsHeight + listHeight + PACKAGE_FOOTER_HEIGHT + COVER_MARGIN);
  const page = output.addPage([coverWidth, height]);
  const ink = rgb(0.12, 0.18, 0.23);
  const muted = rgb(0.38, 0.43, 0.47);
  page.drawRectangle({ x: COVER_MARGIN, y: height - 53, width: 34, height: 4, color: rgb(0.03, 0.38, 0.28) });
  page.drawText("Tender Document Package", { x: COVER_MARGIN, y: height - 88, size: 23, font: bold, color: ink });
  let y = height - 123;
  for (const field of fields) {
    page.drawText(field.label, { x: COVER_MARGIN, y, size: 9, font: bold, color: muted });
    y -= 17;
    for (const line of field.lines) {
      page.drawText(line, { x: COVER_MARGIN, y, size: 11, font: regular, color: ink });
      y -= 15;
    }
    y -= 7;
  }
  y -= 8;
  page.drawLine({ start: { x: COVER_MARGIN, y }, end: { x: coverWidth - COVER_MARGIN, y }, thickness: 0.6, color: rgb(0.85, 0.87, 0.88) });
  y -= 24;
  page.drawText("Included documents", { x: COVER_MARGIN, y, size: 12, font: bold, color: ink });
  y -= 23;
  for (const lines of included) {
    for (const line of lines) {
      page.drawText(line, { x: COVER_MARGIN, y, size: 10, font: regular, color: ink });
      y -= 14;
    }
    y -= 6;
  }
  drawFooter(page, formatPackageFooter(data.tender.tender_id, 1, totalPages), regular);
}

const yieldToBrowser = () => new Promise<void>((done) => setTimeout(done, 0));

export async function generatePackagePdf(
  data: TenderData | null,
  files: readonly UploadedPdf[],
  matches: DocumentMatches,
  expiryDates: ExpiryDateState,
  onProgress?: (progress: PackageProgress) => void,
  madeAt = new Date(),
): Promise<GeneratedPackagePdf> {
  if (!data || !canGeneratePackage(data, files, matches, expiryDates)) throw new PackagePdfError("NOT_READY");
  try {
    const included = getIncludedDocuments(data, files, matches);
    const loaded: { included: IncludedPackageDocument; document: PDFDocument }[] = [];
    onProgress?.({ stage: "loading", completed: 0, total: included.length });
    await yieldToBrowser();
    for (const item of included) {
      try {
        const document = await PDFDocument.load(item.file.bytes, { throwOnInvalidObject: true, updateMetadata: false });
        if (document.isEncrypted || document.getPageCount() < 1) throw new Error("Invalid source PDF");
        loaded.push({ included: item, document });
      } catch {
        throw new PackagePdfError("INVALID_DOCUMENT", item.file.name);
      }
      onProgress?.({ stage: "loading", completed: loaded.length, total: included.length });
      await yieldToBrowser();
    }
    // Count actual source pages before rendering either the cover or any footer.
    const totalPages = 1 + loaded.reduce((total, item) => total + item.document.getPageCount(), 0);
    const output = await PDFDocument.create();
    const regular = await output.embedFont(StandardFonts.Helvetica);
    const bold = await output.embedFont(StandardFonts.HelveticaBold);
    const madeDate = formatPackageMadeDate(madeAt);
    try {
      drawCover(output, data, included, madeDate, regular, bold, totalPages);
    } catch {
      throw new PackagePdfError("UNSUPPORTED_TEXT");
    }
    onProgress?.({ stage: "rendering", completed: 1, total: totalPages });
    for (const item of loaded) {
      try {
        const copies = await output.copyPages(item.document, item.document.getPageIndices());
        for (const page of copies) {
          const pageNumber = output.getPageCount() + 1;
          const footer = formatPackageFooter(data.tender.tender_id, pageNumber, totalPages);
          const originalBox = page.getMediaBox();
          const box = getFooterSafePageBox(originalBox, page.getRotation().angle, regular.widthOfTextAtSize(footer, FOOTER_FONT_SIZE) + 2 * FOOTER_SIDE_MARGIN);
          isolateOriginalContent(page, originalBox);
          page.setMediaBox(box.x, box.y, box.width, box.height);
          page.setCropBox(box.x, box.y, box.width, box.height);
          page.setTrimBox(box.x, box.y, box.width, box.height);
          page.setBleedBox(box.x, box.y, box.width, box.height);
          page.setArtBox(box.x, box.y, box.width, box.height);
          output.addPage(page);
          drawFooter(page, footer, regular);
          onProgress?.({ stage: "rendering", completed: pageNumber, total: totalPages });
          await yieldToBrowser();
        }
      } catch (error: unknown) {
        if (error instanceof PackagePdfError) throw error;
        throw new PackagePdfError("INVALID_DOCUMENT", item.included.file.name);
      }
    }
    output.setTitle(`${data.tender.tender_id} - Tender Document Package`);
    output.setAuthor(data.tender.bidder);
    output.setSubject(data.tender.title);
    output.setCreator("TenderPack");
    output.setCreationDate(madeAt);
    onProgress?.({ stage: "saving", completed: totalPages, total: totalPages });
    await yieldToBrowser();
    const bytes = await output.save();
    return { bytes, filename: getPackageFilename(data.tender.tender_id), pageCount: totalPages, documents: included };
  } catch (error: unknown) {
    if (error instanceof PackagePdfError) throw error;
    throw new PackagePdfError("GENERATION_FAILED");
  }
}

export function downloadPackagePdf(result: GeneratedPackagePdf): void {
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    const blob = new Blob([new Uint8Array(result.bytes)], { type: "application/pdf" });
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
  } catch {
    throw new PackagePdfError("DOWNLOAD_FAILED");
  } finally {
    anchor?.remove();
    if (url) {
      const downloadUrl = url;
      // Allow the browser to begin the download before releasing its backing Blob.
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }
  }
}
