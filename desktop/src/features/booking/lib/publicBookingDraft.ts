import { z } from "zod";

const draftSchema = z.object({
  savedAt: z.number(),
  step: z.enum(["basics", "groups", "occurrences", "contact", "preview"]),
  branchId: z.string(),
  groupId: z.string(),
  ageYears: z.string(),
  lessonKey: z.string(),
  idempotencyKey: z.string().min(1),
  managementToken: z.string().nullable(),
  applicant: z.object({
    parentName: z.string(),
    parentLastName: z.string().optional(),
    phone: z.string(),
    childName: z.string(),
    childBirthDate: z.string(),
    consentAccepted: z.boolean(),
  }),
});

export type PublicBookingDraft = z.infer<typeof draftSchema>;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Scopes progress to this center, booking purpose and entry context. */
export function publicBookingDraftKey(
  organizationId: string,
  purpose: string,
  context: {
    branchId?: string;
    groupId?: string;
    ageYears?: number;
    birthYear?: number;
    birthMonth?: number;
  },
): string {
  const { branchId, groupId, ageYears, birthYear, birthMonth } = context;
  return `airhop:booking-draft:v1:${organizationId}:${purpose}:${JSON.stringify({ branchId, groupId, ageYears, birthYear, birthMonth })}`;
}

/** Restores progress only within this tab; unavailable storage never blocks booking. */
export function readPublicBookingDraft(key: string): PublicBookingDraft | null {
  try {
    const result = draftSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) ?? "null"),
    );
    if (!result.success) return null;
    const age = Date.now() - result.data.savedAt;
    if (age < 0 || age > MAX_AGE_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/** Stores a short-lived draft, preserving the submission key across remounts. */
export function writePublicBookingDraft(
  key: string,
  draft: Omit<PublicBookingDraft, "savedAt">,
): void {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...draft, savedAt: Date.now() }),
    );
  } catch {
    // Private browsing or an embedding policy may disable session storage.
  }
}
