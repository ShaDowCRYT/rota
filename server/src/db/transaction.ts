import { getShardFor } from "./shard.js";
import type { TransactionRunner } from "./types.js";

export const runShardTransaction: TransactionRunner = (teamId, work) =>
  getShardFor(teamId).transaction((tx) => work(tx));
