import { KnowledgeState } from "@bb/types";
import { KnowledgeNotFoundError } from "@bb/errors";
import { _getDb } from "./client.ts";
import { Collections } from "./collections.ts";

export async function setKnowledgeState(knowledgeId: string, state: KnowledgeState): Promise<void> {
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne({ knowledgeId }, { $set: { "status.state": state, updatedAt: new Date() } });
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}
