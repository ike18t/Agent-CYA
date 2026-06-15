import { spawn } from "node:child_process";
import type { ReviewInput } from "./prompt.ts";
import type { Reviewer } from "../pipeline.ts";
import type { LlmDecision } from "./parse.ts";
import { reviewViaCliBinary } from "./cli-binary.ts";
import { reviewViaOpenAI } from "./openai.ts";
import { loadOpenAIConfig } from "./config.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const padAskDecision = async (
  decision: Readonly<LlmDecision>,
  elapsedMs: number,
  minAskMs: number,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<LlmDecision> => {
  if (decision.decision !== "ask" || minAskMs <= 0) return decision;
  const remaining = minAskMs - elapsedMs;
  if (remaining <= 0) return decision;

  await sleepFn(remaining);
  return {
    decision: "ask",
    reason: `${decision.reason} [agent-cya held ${Math.ceil(minAskMs / 1000)}s for human input]`,
  };
};

const runReviewer = async (
  input: Readonly<ReviewInput>,
  reviewer: Reviewer,
  spawnFn: typeof spawn,
  sleepFn: (ms: number) => Promise<void>,
  fetchFn: typeof fetch,
): Promise<LlmDecision> => {
  if (reviewer === "openai") {
    try {
      const config = await loadOpenAIConfig(spawnFn);
      return await reviewViaOpenAI(input, config, fetchFn);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[agent-cya] LLM review failed (openai): ${message}\n`,
      );
      return {
        decision: "ask",
        reason: `LLM unavailable (openai: ${message})`,
      };
    }
  }

  return reviewViaCliBinary(input, reviewer, spawnFn, sleepFn);
};

export const review = async function review(
  input: Readonly<ReviewInput>,
  reviewer: Reviewer,
  minAskMs: number,
  spawnFn: typeof spawn = spawn,
  sleepFn: (ms: number) => Promise<void> = sleep,
  fetchFn: typeof fetch = fetch,
): Promise<LlmDecision> {
  const startMs = Date.now();
  const decision = await runReviewer(
    input,
    reviewer,
    spawnFn,
    sleepFn,
    fetchFn,
  );
  return padAskDecision(decision, Date.now() - startMs, minAskMs, sleepFn);
};
