import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, degrees } from "pdf-lib";

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
const { getRequirementStatus, isBlockingStatus, canGeneratePackage, getReadinessSummary } = loadModule("../lib/status.ts");
const { isValidIsoDate, compareIsoDates } = loadModule("../lib/dates.ts");
const { assignDocument, hasValidMatches, getDuplicateFileIds, getFileAssignment } = loadModule("../lib/matching.ts");
const { formatValidationError, translations } = loadModule("../lib/i18n.ts");
const { sha256 } = loadModule("../lib/hash.ts");
const { loadPdfFile, uploadPdfFiles, MAX_PDF_FILES, MAX_TOTAL_BYTES } = loadModule("../lib/pdf.ts");
const { initialWorkspace, workspaceReducer } = loadModule("../lib/workspace.ts");
const { generatePackagePdf, getIncludedDocuments, getPackageFilename, formatPackageFooter, formatPackageMadeDate, getFooterSafePageBox, PACKAGE_FOOTER_HEIGHT } = loadModule("../lib/package-pdf.ts");

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

test("unmatching releases the exact file and every identical copy, and clears its expiry date", () => {
  const state = { ...initialWorkspace, data: { tender, requirements: [requirement, otherRequirement] }, files: [pdf, duplicate, otherPdf], matches: { req: pdf.id }, expiryDates: { req: deadline } };
  assert.deepEqual(getFileAssignment(pdf, state.matches, state.files, "other"), { requirementId: "req", isDuplicate: false });
  assert.deepEqual(getFileAssignment(duplicate, state.matches, state.files, "other"), { requirementId: "req", isDuplicate: true });
  assert.equal(getFileAssignment(duplicate, state.matches, state.files, "req"), null);
  const unmatched = workspaceReducer(state, { type: "match", requirementId: "req", fileId: "" });
  assert.deepEqual(unmatched.expiryDates, {});
  assert.equal(getFileAssignment(pdf, unmatched.matches, unmatched.files), null);
  assert.equal(getFileAssignment(duplicate, unmatched.matches, unmatched.files), null);
  const reassigned = workspaceReducer(unmatched, { type: "match", requirementId: "other", fileId: duplicate.id });
  assert.deepEqual(reassigned.matches, { other: duplicate.id });
  assert.equal(getRequirementStatus(otherRequirement, duplicate, reassigned.expiryDates.other, deadline), "EXPIRY_NEEDED");
});

test("conflicting assignment preserves the old match and its expiry data", () => {
  const state = { ...initialWorkspace, data: { tender, requirements: [requirement, otherRequirement] }, files: [pdf, duplicate, otherPdf], matches: { req: pdf.id, other: otherPdf.id }, expiryDates: { req: deadline, other: "2026-10-21" } };
  for (const fileId of [pdf.id, duplicate.id]) {
    const rejected = workspaceReducer(state, { type: "match", requirementId: "other", fileId });
    assert.deepEqual(rejected.matches, state.matches);
    assert.deepEqual(rejected.expiryDates, state.expiryDates);
    assert.ok(rejected.matchingError);
  }
});

test("removing one uploaded file clears only its own assignment and expiry", () => {
  const state = { ...initialWorkspace, data: { tender, requirements: [requirement, otherRequirement] }, files: [pdf, duplicate, otherPdf], matches: { req: pdf.id, other: otherPdf.id }, expiryDates: { req: deadline, other: "2026-10-21" } };
  const removed = workspaceReducer(state, { type: "remove-file", fileId: pdf.id });
  assert.deepEqual(removed.matches, { other: otherPdf.id });
  assert.deepEqual(removed.expiryDates, { other: "2026-10-21" });
  assert.equal(getFileAssignment(duplicate, removed.matches, removed.files), null);
});

test("readiness counts track live statuses and optional matched expiry can block generation", () => {
  const optional = { ...otherRequirement, id: "optional", mandatory: false, has_expiry: false };
  const optionalExpiry = { ...optional, id: "optional-expiry", has_expiry: true };
  const mandatory = { ...otherRequirement, has_expiry: false };
  const data = { tender, requirements: [requirement, mandatory, optional, optionalExpiry] };
  const spare = { ...pdf, id: "spare", sha256: "spare-content" };
  const files = [pdf, otherPdf, spare];
  const initial = getReadinessSummary(data, files, {}, {});
  assert.deepEqual([initial.total, initial.ok, initial.blocking, initial.notProvided, initial.canGenerate], [4, 0, 2, 2, false]);
  const matches = { req: pdf.id, other: otherPdf.id };
  const expiry = { req: deadline };
  const ready = getReadinessSummary(data, files, matches, expiry);
  assert.deepEqual([ready.ok, ready.blocking, ready.notProvided, ready.canGenerate], [2, 0, 2, true]);
  const optionalMatched = { ...matches, "optional-expiry": spare.id };
  const missingDate = getReadinessSummary(data, files, optionalMatched, expiry);
  assert.equal(missingDate.statusCounts.EXPIRY_NEEDED, 1);
  assert.equal(missingDate.blocking, 1);
  assert.equal(missingDate.canGenerate, false);
  const expired = getReadinessSummary(data, files, optionalMatched, { ...expiry, "optional-expiry": "2026-10-19" });
  assert.equal(expired.statusCounts.EXPIRED, 1);
  assert.equal(expired.canGenerate, false);
  for (const date of [deadline, "2026-10-21"]) {
    const valid = getReadinessSummary(data, files, optionalMatched, { ...expiry, "optional-expiry": date });
    assert.deepEqual([valid.ok, valid.blocking, valid.notProvided, valid.canGenerate], [3, 0, 1, true]);
  }
  assert.equal(getReadinessSummary(null, files, {}, {}).canGenerate, false);
  assert.equal(getReadinessSummary({ tender, requirements: [] }, files, {}, {}).canGenerate, false);
});

test("the sample tender initially has eight Missing and two non-blocking Not provided statuses", () => {
  const data = parseRequirementsJson(readFileSync(new URL("../requirements.json", import.meta.url), "utf8"));
  assert.equal(data.ok, true);
  const summary = getReadinessSummary(data.value, [], {}, {});
  assert.deepEqual([summary.total, summary.ok, summary.blocking, summary.notProvided], [10, 0, 8, 2]);
  assert.equal(summary.statusCounts.MISSING, 8);
  assert.equal(summary.canGenerate, false);
});

test("validation errors retain schema details and can be rendered in either language", () => {
  const result = validateTenderData({ tender, requirements: [{ ...requirement, order: "1" }] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_ORDER");
  assert.equal(formatValidationError(result, "en"), result.error);
  assert.match(formatValidationError(result, "bn"), /requirements\[0\]\.order/);
  assert.match(formatValidationError(result, "bn"), /সংখ্যা/);
  const malformed = parseRequirementsJson("{bad}");
  assert.equal(formatValidationError(malformed, "en"), malformed.error);
  assert.match(formatValidationError(malformed, "bn"), /সঠিক নয়/);
  for (const status of ["MISSING", "EXPIRY_NEEDED", "EXPIRED", "NOT_PROVIDED", "OK"]) {
    assert.ok(translations.en.statuses[status]);
    assert.ok(translations.bn.statuses[status]);
    assert.ok(translations.en.statusHints[status]);
    assert.ok(translations.bn.statusHints[status]);
  }
});

async function makePdf(name = "valid.pdf", pages = 2) {
  const document = await PDFDocument.create();
  for (let page = 0; page < pages; page++) document.addPage();
  return new File([await document.save()], name, { type: "application/pdf" });
}

function pdfPageText(page) {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index, PDFRawStream))
    : contents ? [contents] : [];
  const decoded = streams.map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join("\n");
  return [...decoded.matchAll(/<([0-9a-f]+)>\s*Tj/gi)].map((match) => Buffer.from(match[1], "hex").toString("latin1")).join("\n");
}

async function markedPdf(name, sizes) {
  const document = await PDFDocument.create();
  for (const [index, size] of sizes.entries()) {
    const page = document.addPage([size.width, size.height]);
    page.setMediaBox(size.x ?? 0, size.y ?? 0, size.width, size.height);
    page.setCropBox(size.x ?? 0, size.y ?? 0, size.width, size.height);
    page.setRotation(degrees(size.rotation ?? 0));
    page.drawText(`Original ${name} page ${index + 1}`, { x: (size.x ?? 0) + 15, y: (size.y ?? 0) + 25, size: 10 });
  }
  return loadPdfFile(new File([await document.save()], name, { type: "application/pdf" }));
}

test("package inclusion sorts numerically, includes matched optional documents, and ignores all unmatched files", () => {
  const early = { ...requirement, id: "early", order: 2 };
  const late = { ...requirement, id: "late", order: 10 };
  const skipped = { ...requirement, id: "skipped", order: 3, mandatory: false };
  const includedOptional = { ...requirement, id: "included-optional", order: 11, mandatory: false };
  const spare = { ...otherPdf, id: "spare", name: "file with spaces.pdf" };
  const data = { tender, requirements: [late, skipped, includedOptional, early] };
  const matches = { late: otherPdf.id, early: pdf.id, "included-optional": spare.id };
  const included = getIncludedDocuments(data, [pdf, otherPdf, spare, duplicate], matches);
  assert.deepEqual(included.map((item) => item.requirement.id), ["early", "late", "included-optional"]);
  assert.equal(included[2].file.name, "file with spaces.pdf");
  assert.deepEqual(data.requirements.map((item) => item.id), ["late", "skipped", "included-optional", "early"]);
});

test("package filenames, footer totals, and creation date follow the required format", () => {
  assert.equal(getPackageFilename("T-2026-0417"), "T-2026-0417_Package.pdf");
  assert.equal(formatPackageFooter("Tender", 1, 12), "Tender | Page 1 of 12");
  assert.equal(formatPackageFooter("Tender", 12, 12), "Tender | Page 12 of 12");
  assert.throws(() => formatPackageFooter("Tender", 0, 12), RangeError);
  assert.throws(() => formatPackageFooter("Tender", 13, 12), RangeError);
  assert.equal(formatPackageMadeDate(new Date("2026-10-06T20:30:00Z")), "2026-10-07");
});

test("generated PDF has one English cover, ordered full source pages, and the correct footer on every page", async () => {
  const first = await markedPdf("first file.pdf", [{ width: 600, height: 800 }, { width: 400, height: 600 }]);
  const last = await markedPdf("landscape.pdf", [{ width: 842, height: 595 }]);
  const optional = await markedPdf("optional.pdf", [{ width: 612, height: 792 }]);
  const unmatched = await markedPdf("unmatched.pdf", [{ width: 612, height: 792 }]);
  const earlyRequirement = { ...requirement, id: "early", order: 2, title_en: "First document", has_expiry: false };
  const lateRequirement = { ...earlyRequirement, id: "late", order: 10, title_en: "Last document" };
  const skippedRequirement = { ...earlyRequirement, id: "skip", order: 5, title_en: "Skipped optional document", mandatory: false };
  const optionalRequirement = { ...earlyRequirement, id: "optional", order: 11, title_en: "Included optional document", mandatory: false };
  const data = { tender, requirements: [lateRequirement, skippedRequirement, optionalRequirement, earlyRequirement] };
  const progress = [];
  const result = await generatePackagePdf(data, [unmatched, first, last, optional], { early: first.id, late: last.id, optional: optional.id }, {}, (value) => progress.push(value), new Date("2026-10-06T09:00:00Z"));
  const output = await PDFDocument.load(result.bytes);
  assert.equal(result.filename, "test_Package.pdf");
  assert.equal(result.pageCount, 5);
  assert.equal(output.getPageCount(), 5);
  const text = output.getPages().map(pdfPageText);
  for (const [index, content] of text.entries()) assert.ok(content.includes(`test | Page ${index + 1} of 5`));
  for (const value of ["Tender Document Package", "Tender ID", tender.title, tender.procuring_entity, tender.bidder, tender.submission_deadline, "Date package was made", "2026-10-06"]) assert.ok(text[0].includes(value), value);
  assert.ok(text[0].indexOf("1. First document") < text[0].indexOf("2. Last document"));
  assert.ok(text[0].indexOf("2. Last document") < text[0].indexOf("3. Included optional document"));
  assert.ok(!text[0].includes("Skipped optional document"));
  assert.ok(text[1].includes("Original first file.pdf page 1"));
  assert.ok(text[2].includes("Original first file.pdf page 2"));
  assert.ok(text[3].includes("Original landscape.pdf page 1"));
  assert.ok(text[4].includes("Original optional.pdf page 1"));
  assert.ok(!text.join("\n").includes("Original unmatched.pdf"));
  assert.deepEqual(output.getPage(3).getMediaBox(), { x: 0, y: -PACKAGE_FOOTER_HEIGHT, width: 842, height: 595 + PACKAGE_FOOTER_HEIGHT });
  assert.deepEqual(progress.at(-1), { stage: "saving", completed: 5, total: 5 });
});

test("footer-safe copies preserve portrait/landscape rotations and nonzero page origins without scaling or cropping", async () => {
  const source = await markedPdf("rotated.pdf", [0, 90, 180, 270].map((rotation) => ({ x: 10, y: 20, width: 300, height: 500, rotation })));
  const data = { tender, requirements: [{ ...requirement, has_expiry: false }] };
  const result = await generatePackagePdf(data, [source], { req: source.id }, {});
  const output = await PDFDocument.load(result.bytes);
  assert.equal(output.getPageCount(), 5);
  const expected = [
    { x: 10, y: -20, width: 300, height: 540 },
    { x: 10, y: 20, width: 340, height: 500 },
    { x: 10, y: 20, width: 300, height: 540 },
    { x: -30, y: 20, width: 340, height: 500 },
  ];
  for (const [index, rotation] of [0, 90, 180, 270].entries()) {
    const page = output.getPage(index + 1);
    assert.equal(page.getRotation().angle, rotation);
    assert.deepEqual(page.getMediaBox(), expected[index]);
    assert.deepEqual(page.getCropBox(), expected[index]);
    assert.ok(pdfPageText(page).includes(`Original rotated.pdf page ${index + 1}`));
    assert.ok(pdfPageText(page).includes(`test | Page ${index + 2} of 5`));
  }
  assert.deepEqual(getFooterSafePageBox({ x: 0, y: 0, width: 60, height: 100 }, 0, 200), { x: -70, y: -40, width: 200, height: 140 });
});

test("generation counts actual source pages and allows a cover-only package for unmatched optional requirements", async () => {
  const source = await markedPdf("actual-pages.pdf", [{ width: 300, height: 500 }, { width: 300, height: 500 }]);
  const result = await generatePackagePdf({ tender, requirements: [{ ...requirement, has_expiry: false }] }, [{ ...source, pageCount: 999 }], { req: source.id }, {});
  assert.equal(result.pageCount, 3);
  const optionalOnly = { tender, requirements: [{ ...requirement, mandatory: false }] };
  const coverOnly = await generatePackagePdf(optionalOnly, [], {}, {});
  assert.equal((await PDFDocument.load(coverOnly.bytes)).getPageCount(), 1);
});

test("generation rejects blocked or duplicate assignments, unreadable files, and unsupported cover text safely", async () => {
  const data = { tender, requirements: [requirement] };
  await assert.rejects(generatePackagePdf(data, [], {}, {}), (error) => error.code === "NOT_READY");
  await assert.rejects(generatePackagePdf(data, [pdf], { req: pdf.id }, { req: "2026-10-19" }), (error) => error.code === "NOT_READY");
  await assert.rejects(generatePackagePdf({ tender, requirements: [requirement, otherRequirement] }, [pdf, duplicate], { req: pdf.id, other: duplicate.id }, { req: deadline, other: deadline }), (error) => error.code === "NOT_READY");
  await assert.rejects(generatePackagePdf(data, [pdf], { req: pdf.id }, { req: deadline }), (error) => error.code === "INVALID_DOCUMENT" && error.filename === pdf.name);
  const source = await markedPdf("valid.pdf", [{ width: 300, height: 500 }]);
  await assert.rejects(generatePackagePdf({ tender: { ...tender, title: "বাংলা শিরোনাম" }, requirements: [{ ...requirement, has_expiry: false }] }, [source], { req: source.id }, {}), (error) => error.code === "UNSUPPORTED_TEXT");
});

test("many matched documents and long cover fields stay on one complete cover", async () => {
  const files = [];
  const requirements = [];
  const matches = {};
  for (let index = 1; index <= 30; index++) {
    const file = await markedPdf(`document ${index}.pdf`, [{ width: 300, height: 500 }]);
    const id = `item-${index}`;
    files.push(file);
    requirements.unshift({ ...requirement, id, order: index, title_en: `Document ${index} with a longer English title describing its supporting evidence`, has_expiry: false });
    matches[id] = file.id;
  }
  const result = await generatePackagePdf({ tender: { ...tender, title: "A detailed tender title ".repeat(10) }, requirements }, files, matches, {});
  const output = await PDFDocument.load(result.bytes);
  assert.equal(output.getPageCount(), 31);
  const coverText = pdfPageText(output.getPage(0));
  assert.ok(coverText.includes("1. Document 1"));
  assert.ok(coverText.includes("30. Document 30"));
  assert.ok(coverText.includes("test | Page 1 of 31"));
});

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
