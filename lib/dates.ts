/** Validate calendar dates without local time zones or permissive Date parsing. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function compareIsoDates(left: string, right: string): -1 | 0 | 1 {
  if (!isValidIsoDate(left) || !isValidIsoDate(right)) {
    throw new Error("Dates must be valid YYYY-MM-DD calendar dates.");
  }
  return left === right ? 0 : left < right ? -1 : 1;
}
