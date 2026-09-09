import type {
  ClientConversation,
  ClientInbox,
} from "@/features/client-inbox/data/clientInboxService";
import type { MentionCandidate } from "./mentionCandidates";
import { normalizePubkey } from "@/shared/lib/pubkey";

export function clientMentionCandidates(
  candidates: MentionCandidate[],
  conversation: ClientConversation | undefined,
  staff: ClientInbox["staff"],
  members: ReadonlySet<string>,
): MentionCandidate[] {
  if (!conversation) return candidates;
  const keys = new Set(
    staff
      .filter((item) => item.channelId === conversation.channelId)
      .map((item) => normalizePubkey(item.pubkey)),
  );
  const hermes = conversation.hermesPubkey
    ? normalizePubkey(conversation.hermesPubkey)
    : null;
  const result = candidates.filter(
    (candidate) =>
      candidate.kind === "identity" &&
      candidate.pubkey &&
      candidate.pubkey !== conversation.connectorPubkey &&
      ((!candidate.isAgent && keys.has(candidate.pubkey)) ||
        candidate.pubkey === hermes),
  );
  if (hermes && !result.some((candidate) => candidate.pubkey === hermes)) {
    result.push({
      kind: "identity",
      pubkey: hermes,
      displayName: "Администратор Гермес",
      isAgent: true,
      isMember: members.has(hermes),
    });
  }
  return result.map((candidate) =>
    candidate.pubkey === hermes && conversation.hermesInChannel !== undefined
      ? { ...candidate, isMember: conversation.hermesInChannel }
      : candidate,
  );
}
