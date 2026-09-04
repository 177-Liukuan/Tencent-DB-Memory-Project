import type { InputInspection } from "./config.js";
import { readPipelineStatus } from "./release.js";

export type VerificationTarget = {
  label: string;
  baseUrl: string;
  apiKey: string;
  serviceId: string;
  userId: string;
  teamId: string;
  agentId: string;
};

export type VerificationResult = {
  target: string;
  sessions: number;
  messages: number;
  skills: number;
  pipelineIdle: boolean;
};

type ApiEnvelope<T> = { code: number; message?: string; data?: T };

async function post<T>(target: VerificationTarget, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${target.baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      "content-type": "application/json",
      "x-tdai-service-id": target.serviceId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!response.ok || envelope.code !== 0 || envelope.data === undefined) {
    throw new Error(`${target.label} ${path} failed (${envelope.code ?? response.status}): ${envelope.message ?? response.statusText}`);
  }
  return envelope.data;
}

export async function verifyPreparedTarget(options: {
  target: VerificationTarget;
  inspection: InputInspection;
}): Promise<VerificationResult> {
  const { target, inspection } = options;
  let messages = 0;
  for (const session of inspection.sessions) {
    const result = await post<{ total: number }>(target, "/v3/conversation/count", {
      team_id: target.teamId,
      user_id: target.userId,
      agent_id: target.agentId,
      session_id: session.sessionId,
    });
    if (result.total !== session.messageCount) {
      throw new Error(`${target.label}: ${session.sessionId} has ${result.total} L0 messages; expected ${session.messageCount}`);
    }
    messages += result.total;
  }

  const skillList = await post<{ items: Array<{ name: string }> }>(target, "/v3/skill/list", {
    user_id: target.userId,
    team_id: target.teamId,
    agent_id: target.agentId,
    filters: { owner_agent_id: target.agentId, status: ["active"] },
    pagination: { limit: 1000, offset: 0 },
  });
  const actualNames = new Set(skillList.items.map((item) => item.name));
  const missingSkills = inspection.skillNames.filter((name) => !actualNames.has(name));
  if (missingSkills.length > 0) throw new Error(`${target.label}: missing imported Skills: ${missingSkills.join(", ")}`);

  const status = await readPipelineStatus(target.baseUrl, target.apiKey, target.serviceId);
  const pipelineIdle = status.l1.idle && status.l2.idle && status.l3.idle;
  if (!pipelineIdle) throw new Error(`${target.label}: memory processing is still active after installation`);
  return {
    target: target.label,
    sessions: inspection.sessions.length,
    messages,
    skills: inspection.skillNames.length,
    pipelineIdle,
  };
}
