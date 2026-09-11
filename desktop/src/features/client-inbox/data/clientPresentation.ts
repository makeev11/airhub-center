import type { ClientConversation } from "./clientInboxService";

/** Presentation only: never changes the signed message or shared connector identity. */
export function clientMessagePresentation(
  conversations: readonly ClientConversation[],
  message: {
    id: string;
    pubkey?: string | null;
    signerPubkey?: string;
    rootId?: string | null;
  },
) {
  const conversation = conversations.find(
    (item) => item.rootEventId === (message.rootId ?? message.id),
  );
  if (!conversation) return null;
  const isParent = Boolean(
    conversation.connectorPubkey &&
      (message.signerPubkey ?? message.pubkey)?.toLowerCase() ===
        conversation.connectorPubkey.toLowerCase(),
  );
  return {
    conversation,
    isRoot: message.id === conversation.rootEventId,
    parentLabel: isParent
      ? conversation.parentName?.trim() || `Клиент · ${conversation.provider}`
      : null,
    title: conversation.title,
  };
}
