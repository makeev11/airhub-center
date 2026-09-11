import { z } from "zod";
const key = z.string().regex(/^[0-9a-f]{64}$/);
export const principalDirectorySchema = z.object({
  communityId: z.string().uuid(),
  organizationId: z.string().uuid(),
  agents: z.array(
    z.object({
      id: z.string(),
      pubkey: key,
      role: z.enum([
        "fizz",
        "administrator",
        "analyst",
        "content_marketer",
        "parent_administrator",
      ]),
      deploymentId: z.string().uuid().nullable(),
    }),
  ),
  principals: z.array(
    z.object({ pubkey: key, kind: z.enum(["agent", "connector", "service"]) }),
  ),
});
export type AirhopPrincipalDirectory = z.infer<typeof principalDirectorySchema>;

/** Fail closed for unknown service classification, but never exclude unnamed humans. */
export function humanMembers<T extends { pubkey: string }>(
  members: readonly T[],
  directory: AirhopPrincipalDirectory,
): T[] {
  const services = new Set(directory.principals.map((item) => item.pubkey));
  return members.filter((member) => !services.has(member.pubkey.toLowerCase()));
}
