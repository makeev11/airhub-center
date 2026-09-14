import { z } from "zod";

export const agentRoleSchema = z.enum([
  "fizz",
  "administrator",
  "analyst",
  "content_marketer",
  "parent_administrator",
]);
const time = z
  .object({
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  })
  .strict();
export const analyticsSectionSchema = z.enum([
  "bookings",
  "payments",
  "attendance",
  "capacity",
  "acquisition",
]);
export const agentCommunicationSchema = z
  .object({
    audience: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("staff") }).strict(),
      z.object({ mode: z.literal("owner") }).strict(),
      z
        .object({
          mode: z.literal("selected"),
          pubkeys: z
            .array(z.string().regex(/^[0-9a-f]{64}$/))
            .min(1)
            .max(200)
            .refine((keys) => new Set(keys).size === keys.length),
        })
        .strict(),
    ]),
    surfaces: z.enum(["both", "channels", "direct_messages"]),
  })
  .strict();
export type AgentCommunication = z.infer<typeof agentCommunicationSchema>;
export const agentPolicySchema = z
  .object({
    enabled: z.boolean(),
    communication: agentCommunicationSchema.nullable().optional(),
    birthdays: z
      .object({
        enabled: z.boolean(),
        today: z.boolean(),
        advanceDays: z.number().int().min(0).max(30),
        time,
        destination: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("branches") }).strict(),
          z
            .object({
              mode: z.literal("channel"),
              channelId: z.string().uuid(),
            })
            .strict(),
        ]),
      })
      .strict()
      .nullable(),
    analytics: z
      .object({
        enabled: z.boolean(),
        channelId: z.string().uuid().nullable(),
        time,
        weekday: z.number().int().min(1).max(7).nullable(),
        sections: z.array(analyticsSectionSchema).max(5),
      })
      .strict()
      .nullable(),
    content: z.object({ websiteEditing: z.boolean() }).strict().nullable(),
    learning: z.enum(["off", "observe", "validated"]),
  })
  .strict();
export const procedurePlanSchema = z.object({
  graphVersion: z.string(),
  sources: z.array(
    z.enum([
      "knowledge",
      "organization",
      "family",
      "schedule",
      "center_analytics",
      "site_analytics",
      "tracking_links",
    ]),
  ),
});
export const procedureReviewSchema = z.object({
  version: z.number().int().nonnegative(),
  activeId: z.string().uuid().nullable(),
  candidates: z.array(
    z.object({
      id: z.string().uuid(),
      plan: procedurePlanSchema,
      observations: z.number().int().nonnegative(),
    }),
  ),
});
export const agentPolicyEntrySchema = z.object({
  role: agentRoleSchema,
  version: z.number().int().nonnegative(),
  policy: agentPolicySchema,
  procedures: procedureReviewSchema.optional(),
});
export const agentPoliciesSchema = z.object({
  schemaVersion: z.literal("airhop.agent-policies.v1"),
  canManage: z.boolean(),
  policies: z.array(agentPolicyEntrySchema),
});
export type AgentPolicy = z.infer<typeof agentPolicySchema>;
export type AgentPolicyEntry = z.infer<typeof agentPolicyEntrySchema>;
export type AgentPolicies = z.infer<typeof agentPoliciesSchema>;

/** A complete draft is validated before the event is signed. Server validation is authoritative. */
export function validateAgentPolicy(
  role: AgentPolicyEntry["role"],
  draft: AgentPolicy,
): AgentPolicy {
  const policy = agentPolicySchema.parse(draft);
  if (role === "parent_administrator" && policy.communication) {
    throw new Error(
      "External parent conversations use their own scoped access policy",
    );
  }
  if (
    (policy.birthdays !== null) !== (role === "administrator") ||
    (policy.analytics !== null) !== (role === "analyst") ||
    (policy.content !== null) !== (role === "content_marketer")
  )
    throw new Error("Agent duties do not match this role");
  if (
    policy.birthdays?.enabled &&
    !policy.birthdays.today &&
    policy.birthdays.advanceDays === 0
  )
    throw new Error("Choose a birthday notification");
  if (
    policy.analytics &&
    (new Set(policy.analytics.sections).size !==
      policy.analytics.sections.length ||
      (policy.analytics.enabled && policy.analytics.sections.length === 0))
  )
    throw new Error("Choose distinct report sections");
  return policy;
}
