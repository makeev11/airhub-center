import type { PublicBookingInitialContext } from "@/features/booking/ui/PublicBookingFlow";

export function initialPublicBirthMonth(
  context: PublicBookingInitialContext,
): string {
  if (
    !Number.isInteger(context.birthYear) ||
    !Number.isInteger(context.birthMonth) ||
    (context.birthYear ?? 0) < 1900 ||
    (context.birthMonth ?? 0) < 1 ||
    (context.birthMonth ?? 0) > 12
  ) {
    return "";
  }
  return `${context.birthYear}-${String(context.birthMonth).padStart(2, "0")}`;
}

export function parsePublicBirthMonth(value: string): {
  birthYear: number;
  birthMonth: number;
} | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const birthYear = Number(match[1]);
  const birthMonth = Number(match[2]);
  if (birthYear < 1900 || birthMonth < 1 || birthMonth > 12) return null;
  return { birthYear, birthMonth };
}

export function parsePublicAge(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null;
  const age = Number(value);
  return Number.isInteger(age) && age >= 0 && age <= 17 ? age : null;
}

export function initialPublicAge(
  context: PublicBookingInitialContext,
  currentDate: string,
): string {
  if (
    Number.isInteger(context.ageYears) &&
    (context.ageYears ?? 0) >= 0 &&
    (context.ageYears ?? 0) <= 17
  ) {
    return String(context.ageYears);
  }
  const birthMonth = initialPublicBirthMonth(context);
  const currentMatch = /^(\d{4})-(\d{2})-\d{2}$/.exec(currentDate);
  const birthMatch = /^(\d{4})-(\d{2})$/.exec(birthMonth);
  if (!currentMatch || !birthMatch) return "";
  const currentYear = Number(currentMatch[1]);
  const currentMonth = Number(currentMatch[2]);
  const birthYear = Number(birthMatch[1]);
  const birthMonthNumber = Number(birthMatch[2]);
  const age =
    currentYear - birthYear - (currentMonth <= birthMonthNumber ? 1 : 0);
  return age >= 0 && age <= 17 ? String(age) : "";
}

export type PublicInitialContextResolution = {
  attributionBranchId?: string;
  ageYears: string;
  branchId: string;
  canLoadOccurrences: boolean;
  contextFallback: boolean;
  groupId: string;
};

export function resolvePublicInitialContext(
  context: PublicBookingInitialContext,
  activeBranchIds: readonly string[],
  currentDate: string,
): PublicInitialContextResolution {
  const ageYears = initialPublicAge(context, currentDate);
  const branchRequested = Boolean(context.branchId);
  const ageRequested =
    context.ageYears !== undefined ||
    context.birthYear !== undefined ||
    context.birthMonth !== undefined;
  const groupRequested = Boolean(context.groupId);
  const validBranch = Boolean(
    context.branchId && activeBranchIds.includes(context.branchId),
  );
  const validAge = Boolean(ageYears);
  const canLoadOccurrences = validBranch && validAge;
  const contextFallback =
    (branchRequested && !validBranch) ||
    (ageRequested && !validAge) ||
    (groupRequested && !canLoadOccurrences);

  return {
    ...(validBranch ? { attributionBranchId: context.branchId } : {}),
    ageYears: validAge ? ageYears : "",
    branchId: validBranch ? (context.branchId ?? "") : "",
    canLoadOccurrences,
    contextFallback,
    groupId: canLoadOccurrences ? (context.groupId ?? "") : "",
  };
}
