import { isValidIsoDate } from "./dates";
import type { TenderData, TenderRequirement, ValidationResult } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function sortRequirements(requirements: readonly TenderRequirement[]): TenderRequirement[] {
  return [...requirements].sort((left, right) => left.order - right.order);
}

export function validateTenderData(input: unknown): ValidationResult<TenderData> {
  if (!isRecord(input) || !isRecord(input.tender) || !Array.isArray(input.requirements)) {
    return { ok: false, code: "INVALID_STRUCTURE", error: "Expected an object containing tender details and a requirements array." };
  }
  const tender = input.tender;
  for (const key of ["tender_id", "title", "procuring_entity", "bidder", "submission_deadline"]) {
    if (!isNonEmptyString(tender[key])) {
      return { ok: false, code: "REQUIRED_STRING", path: `tender.${key}`, error: `tender.${key} must be a non-empty string.` };
    }
  }
  const deadline = String(tender.submission_deadline);
  if (!isValidIsoDate(deadline)) {
    return { ok: false, code: "INVALID_DEADLINE", error: "tender.submission_deadline must be a valid date in YYYY-MM-DD format." };
  }

  const requirements: TenderRequirement[] = [];
  const seenIds = new Set<string>();
  for (const [index, item] of input.requirements.entries()) {
    const path = `requirements[${index}]`;
    if (!isRecord(item)) return { ok: false, code: "INVALID_REQUIREMENT", path, error: `${path} must be an object.` };
    for (const key of ["id", "title_en", "title_bn"]) {
      if (!isNonEmptyString(item[key])) {
        return { ok: false, code: "REQUIRED_STRING", path: `${path}.${key}`, error: `${path}.${key} must be a non-empty string.` };
      }
    }
    if (typeof item.order !== "number" || !Number.isFinite(item.order)) {
      return { ok: false, code: "INVALID_ORDER", path, error: `${path}.order must be a finite number.` };
    }
    if (typeof item.mandatory !== "boolean" || typeof item.has_expiry !== "boolean") {
      return { ok: false, code: "INVALID_FLAGS", path, error: `${path}.mandatory and has_expiry must be booleans.` };
    }
    const id = String(item.id).trim();
    if (seenIds.has(id)) return { ok: false, code: "DUPLICATE_ID", requirementId: id, error: `Requirement ID "${id}" appears more than once.` };
    seenIds.add(id);
    requirements.push({
      id,
      order: item.order,
      title_en: String(item.title_en).trim(),
      title_bn: String(item.title_bn).trim(),
      mandatory: item.mandatory,
      has_expiry: item.has_expiry,
    });
  }
  return {
    ok: true,
    value: {
      tender: {
        tender_id: String(tender.tender_id).trim(),
        title: String(tender.title).trim(),
        procuring_entity: String(tender.procuring_entity).trim(),
        bidder: String(tender.bidder).trim(),
        submission_deadline: deadline,
      },
      requirements: sortRequirements(requirements),
    },
  };
}

export function parseRequirementsJson(text: string): ValidationResult<TenderData> {
  let input: unknown;
  try {
    input = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, code: "MALFORMED_JSON", error: "This file contains malformed JSON. Check its syntax and try again." };
  }
  return validateTenderData(input);
}
