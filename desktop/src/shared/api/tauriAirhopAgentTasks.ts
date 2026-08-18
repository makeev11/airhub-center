import { invokeTauri } from "@/shared/api/tauri";

export async function dispatchAirhopAgentTask(input: {
  channelId: string;
  agentPubkey: string;
  taskId: string;
  stage: string;
  instruction: string;
}): Promise<string> {
  return invokeTauri<string>("dispatch_airhop_agent_task", input);
}
