import type { JobMessage, JobPriority, JobType, PayloadFor } from "@bb/types";

export function buildJobMessage<T extends JobType>(
  type: T,
  priority: JobPriority,
  payload: PayloadFor<T>,
): JobMessage<PayloadFor<T>> {
  return {
    id: crypto.randomUUID(),
    type,
    priority,
    knowledgeId: payload.knowledgeId,
    attempt: 0,
    createdAt: new Date().toISOString(),
    payload,
  };
}

const PRIORITY_TO_BULLMQ: Record<JobPriority, number> = {
  0: 1000,
  1: 100,
  2: 10,
};

export function mapPriority(priority: JobPriority): number {
  return PRIORITY_TO_BULLMQ[priority];
}

export function dedupeKey(type: JobType, knowledgeId: string): string {
  return `${type}-${knowledgeId}`;
}
