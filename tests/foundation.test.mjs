import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";
import { PDFDocument } from "pdf-lib";

// Execute the actual TypeScript helpers without adding a separate test framework.
const loadModule = createRequire(import.meta.url);
loadModule.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const { parseRequirementsJson, validateTenderData, sortRequirements } = loadModule("../lib/requirements.ts");
const { getRequirementStatus, isBlockingStatus, canGeneratePackage } = loadModule("../lib/status.ts");
const { isValidIsoDate, compareIsoDates } = loadModule("../lib/dates.ts");
const { assignDocument, hasValidMatches, getDuplicateFileIds } = loadModule("../lib/matching.ts");
const { sha256 } = loadModule("../lib/hash.ts");
const { loadPdfFile, uploadPdfFiles, MAX_PDF_FILES, MAX_TOTAL_BYTES } = loadModule("../lib/pdf.ts");
const { initialWorkspace, workspaceReducer } = loadModule("../lib/workspace.ts");

const requirement = { id: "req", order: 1, title_en: "Test document", title_bn: "পরীক্ষার নথি", mandatory: true, has_expiry: true };
const tender = { tender_id: "test", title: "Test tender", procuring_entity: "Test entity", bidder: "Test bidder", submission_deadline: "2026-10-20" };
const pdf = { id: "file-1", name: "original.pdf", size: 200, pageCount: 1, sha256: "same-content", bytes: new Uint8Array([1, 2, 3]) };
const duplicate = { ...pdf, id: "file-2", name: "different-name.pdf" };
const otherPdf = { ...pdf, id: "file-3", sha256: "other-content" };
const otherRequirement = { ...requirement, id: "other", order: 2 };
const deadline = tender.submission_deadline;

test("all status rules, including optional matched documents and the deadline boundary", () => {
  assert.equal(getRequirementStatus(requirement, undefined, undefined, deadline), "MISSING");
  assert.equal(getRequirementStatus({ ...requirement, mandatory: false }, undefined, "2026-01-01", deadline), "NOT_PROVIDED");
  assert.equal(getRequirementStatus(requirement, pdf, "", deadline), "EXPIRY_NEEDED");
  assert.equal(getRequirementStatus(requirement, pdf, "2026-10-19", deadline), "EXPIRED");
  assert.equal(getRequirementStatus(requirement, pdf, deadline, deadline), "OK");
  assert.equal(getRequirementStatus(requirement, pdf, "2026-10-21", deadline), "OK");
  assert.equal(getRequirementStatus({ ...requirement, has_expiry: false }, pdf, "", deadline), "OK");
  assert.equal(getRequirementStatus({ ...requirement, mandatory: false }, pdf, "", deadline), "EXPIRY_NEEDED");
  assert.equal(getRequirementStatus(requirement, pdf, "2026-02-30", deadline), "EXPIRY_NEEDED");
  assert.deepEqual(["MISSING", "EXPIRY_NEEDED", "EXPIRED", "NOT_PROVIDED", "OK"].map(isBlockingStatus), [true, true, true, false, false]);
});

test("ISO date validation rejects rollover and noncanonical dates without time-zone conversion", () => {
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "0000-01-01", "", "2026-10-20T00:00:00Z"]) assert.equal(isValidIsoDate(date), false, date);
  assert.equal(isValidIsoDate("2024-02-29"), true);
  assert.equal(isValidIsoDate("2000-02-29"), true);
  assert.equal(isValidIsoDate("1900-02-29"), false);
  assert.equal(compareIsoDates(deadline, deadline), 0);
  assert.equal(compareIsoDates("2026-09-30", "2026-10-01"), -1);
});

test("JSON parsing and validation rejects malformed structure, fields, dates, and duplicate IDs", () => {
  assert.equal(parseRequirementsJson("{bad json}").ok, false);
  for (const input of [null, [], {}, { tender, requirements: "bad" }, { tender: { ...tender, submission_deadline: "2026-02-30" }, requirements: [] }, { tender, requirements: [{ ...requirement, mandatory: "true" }] }, { tender, requirements: [{ ...requirement, order: "1" }] }, { tender, requirements: [{ ...requirement, order: Infinity }] }, { tender, requirements: [requirement, { ...requirement }] }]) assert.equal(validateTenderData(input).ok, false);
  assert.equal(parseRequirementsJson(`\uFEFF${JSON.stringify({ tender, requirements: [requirement] })}`).ok, true);
});

test("unseen unsorted requirements are sorted numerically without mutating the input", () => {
  const unsorted = [{ ...requirement, id: "ten", order: 10 }, { ...requirement, id: "two", order: 2 }, requirement];
  const result = validateTenderData({ tender, requirements: unsorted });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.requirements.map((item) => item.order), [1, 2, 10]);
  assert.deepEqual(sortRequirements(unsorted).map((item) => item.order), [1, 2, 10]);
  assert.deepEqual(unsorted.map((item) => item.order), [10, 2, 1]);
});

test("matching prevents reuse of a file or identical contents across requirements", () => {
  const requirements = [requirement, otherRequirement];
  const files = [pdf, duplicate, otherPdf];
  const matches = { req: pdf.id };
  assert.deepEqual(assignDocument(matches, "other", pdf.id, requirements, files), { ok: false, code: "FILE_IN_USE" });
  assert.deepEqual(assignDocument(matches, "other", duplicate.id, requirements, files), { ok: false, code: "DUPLICATE_IN_USE" });
  assert.deepEqual(assignDocument(matches, "req", duplicate.id, requirements, files), { ok: true, matches: { req: duplicate.id } });
  assert.deepEqual(assignDocument(matches, "other", otherPdf.id, requirements, files), { ok: true, matches: { req: pdf.id, other: otherPdf.id } });
  assert.equal(assignDocument(matches, "missing", pdf.id, requirements, files).ok, false);
  assert.equal(assignDocument(matches, "req", "missing", requirements, files).ok, false);
  assert.deepEqual(matches, { req: pdf.id });
  assert.equal(hasValidMatches(requirements, files, { req: pdf.id, other: duplicate.id }), false);
});

test("every copy is marked as duplicate and the mark clears after removal", () => {
  assert.deepEqual([...getDuplicateFileIds([pdf, duplicate, otherPdf])], [pdf.id, duplicate.id]);
  assert.equal(getDuplicateFileIds([pdf, otherPdf]).size, 0);
});

test("readiness requires complete valid matches and valid expiry dates", () => {
  const data = { tender, requirements: [requirement, { ...otherRequirement, mandatory: false }] };
  assert.equal(canGeneratePackage(data, [pdf], {}, {}), false);
  assert.equal(canGeneratePackage(data, [pdf], { req: pdf.id }, {}), false);
  assert.equal(canGeneratePackage(data, [pdf], { req: pdf.id }, { req: "2026-10-19" }), false);
  assert.equal(canGeneratePackage(data, [pdf], { req: pdf.id }, { req: deadline }), true);
  assert.equal(canGeneratePackage(data, [pdf], { req: "deleted" }, { req: deadline }), false);
  assert.equal(canGeneratePackage(data, [pdf, duplicate], { req: pdf.id, other: duplicate.id }, { req: deadline, other: deadline }), false);
  assert.equal(canGeneratePackage(null, [pdf], {}, {}), false);
});

test("file replacement/removal clears expiry; loading a new tender resets matches and preserves PDFs", () => {
  const state = { ...initialWorkspace, data: { tender, requirements: [requirement] }, files: [pdf, otherPdf], matches: { req: pdf.id }, expiryDates: { req: deadline } };
  const replaced = workspaceReducer(state, { type: "match", requirementId: "req", fileId: otherPdf.id });
  assert.deepEqual(replaced.expiryDates, {});
  const removed = workspaceReducer(state, { type: "remove-file", fileId: pdf.id });
  assert.deepEqual(removed.matches, {});
  assert.deepEqual(removed.expiryDates, {});
  const reloaded = workspaceReducer(state, { type: "load-tender", data: state.data });
  assert.deepEqual(reloaded.matches, {});
  assert.deepEqual(reloaded.expiryDates, {});
  assert.equal(reloaded.files.length, 2);
  assert.equal(state.files.length, 2);
});

async function makePdf(name = "valid.pdf", pages = 2) {
  const document = await PDFDocument.create();
  for (let page = 0; page < pages; page++) document.addPage();
  return new File([await document.save()], name, { type: "application/pdf" });
}

test("real PDF loading retains original bytes, computes pages and filename-independent SHA-256", async () => {
  const original = await makePdf();
  const copy = new File([await original.arrayBuffer()], "renamed.pdf", { type: "application/pdf" });
  const first = await loadPdfFile(original);
  const second = await loadPdfFile(copy);
  assert.equal(first.pageCount, 2);
  assert.equal(first.size, original.size);
  assert.equal(first.sha256.length, 64);
  assert.equal(first.sha256, second.sha256);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.bytes, new Uint8Array(await original.arrayBuffer()));
  assert.equal(await sha256(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("mixed batches retain valid PDFs and show failures for non-PDF, renamed junk, damaged and empty files", async () => {
  const valid = await makePdf();
  const result = await uploadPdfFiles([
    new File(["image"], "logo.png", { type: "image/png" }),
    new File(["junk"], "renamed.pdf", { type: "application/pdf" }),
    new File(["%PDF-1.7\ncorrupt"], "damaged.pdf", { type: "application/pdf" }),
    new File([], "empty.pdf", { type: "application/pdf" }),
    valid,
  ], []);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].pageCount, 2);
  assert.deepEqual(result.errors.map((error) => error.code), ["NOT_PDF", "INVALID_PDF", "INVALID_PDF", "EMPTY_FILE"]);
});

test("30-file and 50 MB limits include existing uploads, accept exact limits and reject overflow", async () => {
  const valid = await makePdf();
  const existing = Array.from({ length: MAX_PDF_FILES - 1 }, (_, index) => ({ ...pdf, id: `existing-${index}` }));
  const countResult = await uploadPdfFiles([valid, valid], existing);
  assert.equal(countResult.files.length, 1);
  assert.equal(countResult.errors[0].code, "TOO_MANY_FILES");
  const byteResult = await uploadPdfFiles([valid, valid], [{ ...pdf, size: MAX_TOTAL_BYTES - valid.size }]);
  assert.equal(byteResult.files.length, 1);
  assert.equal(byteResult.errors[0].code, "TOTAL_TOO_LARGE");
});

test("an unreadable PDF releases its quota so the next valid file can be added", async () => {
  const unreadable = { name: "unreadable.pdf", type: "application/pdf", size: 1, arrayBuffer: async () => { throw new Error("read failed"); } };
  const existing = Array.from({ length: MAX_PDF_FILES - 1 }, (_, index) => ({ ...pdf, id: `existing-${index}` }));
  const result = await uploadPdfFiles([unreadable, await makePdf()], existing);
  assert.equal(result.errors[0].code, "READ_FAILED");
  assert.equal(result.files.length, 1);
});

test("encrypted PDFs and PDFs without pages fail with friendly error codes", async () => {
  const document = await PDFDocument.create();
  document.addPage();
  document.context.trailerInfo.Encrypt = document.context.register(document.context.obj({ Filter: "Standard", V: 1, R: 2 }));
  const encrypted = new File([await document.save()], "protected.pdf", { type: "application/pdf" });
  await assert.rejects(loadPdfFile(encrypted), /ENCRYPTED_PDF/);
  const emptyDocument = await PDFDocument.create();
  const pageLess = new File([await emptyDocument.save({ addDefaultPage: false })], "no-pages.pdf", { type: "application/pdf" });
  await assert.rejects(loadPdfFile(pageLess), /INVALID_PDF/);
});

test("the supplied sample PDFs load and renamed experience certificates are duplicates", async () => {
  const data = parseRequirementsJson(readFileSync(new URL("../requirements.json", import.meta.url), "utf8"));
  assert.equal(data.ok, true);
  const files = readdirSync(new URL("../documents/", import.meta.url)).filter((filename) => filename.endsWith(".pdf"));
  const uploaded = [];
  for (const filename of files) {
    const path = new URL(`../documents/${filename}`, import.meta.url);
    uploaded.push(await loadPdfFile(new File([readFileSync(fileURLToPath(path))], filename, { type: "application/pdf" })));
  }
  assert.ok(uploaded.every((file) => file.pageCount > 0));
  const original = uploaded.find((file) => file.name === "experience_cert.pdf");
  const renamed = uploaded.find((file) => file.name === "experience_cert (1).pdf");
  assert.equal(original.sha256, renamed.sha256);
  assert.equal(getDuplicateFileIds(uploaded).size, 2);
});
