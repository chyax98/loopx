import {z} from "zod";
import {goalAcceptanceContractSchema} from "./goal-acceptance-observation";
const responseSchema = z.object({ok: z.literal(true), goal_id: z.string(), provider_revision: z.string(),
  goal_acceptance_contract: goalAcceptanceContractSchema, checks_passed: z.boolean().optional()});
export type AcceptanceReadback = z.infer<typeof responseSchema>;
export async function acceptanceRequest(goalId: string, operation?: Record<string, unknown>): Promise<AcceptanceReadback> {
  const url = "/api/chat/goal-acceptance";
  const response = await fetch(operation ? url : `${url}?goal_id=${encodeURIComponent(goalId)}`, operation
    ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({...operation, goal_id: goalId})} : undefined);
  if (!response.ok) throw new Error("Acceptance unavailable");
  const result = responseSchema.parse(await response.json());
  if (result.goal_id !== goalId) throw new Error("Acceptance source changed");
  return result;
}
