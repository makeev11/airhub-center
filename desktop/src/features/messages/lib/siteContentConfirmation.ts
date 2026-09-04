const SITE_CONTENT_CONFIRMATION_PATTERN = /^Подтверждаю [A-F0-9]{12}$/u;

export const AIRHOP_CONTENT_MARKETER_PERSONA_ID =
  "builtin:airhop-content-marketer";

/**
 * Route an exact Airhop site-content confirmation to the built-in content
 * marketer without changing the signed message body. HQ can therefore verify
 * the one-time phrase byte-for-byte while the mention-only ACP subscription
 * still receives the owner's message.
 */
export function routeSiteContentConfirmation(
  content: string,
  mentionPubkeys: readonly string[] | undefined,
  contentMarketerPubkey: string | null | undefined,
): string[] {
  const mentions = [...(mentionPubkeys ?? [])];
  const marketer = contentMarketerPubkey?.trim().toLowerCase();
  if (!marketer || !SITE_CONTENT_CONFIRMATION_PATTERN.test(content.trim())) {
    return mentions;
  }

  if (!mentions.some((pubkey) => pubkey.trim().toLowerCase() === marketer)) {
    mentions.push(marketer);
  }
  return mentions;
}
