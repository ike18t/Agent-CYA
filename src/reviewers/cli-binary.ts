import { spawn } from "node:child_process";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.ts";
import type { ReviewInput } from "./prompt.ts";
import { parseLlmResponse } from "./parse.ts";
import type { LlmDecision } from "./parse.ts";

const SPAWN_TIMEOUT_MS = 90_000;
const RETRY_DELAY_MS = 500;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type CliBinaryReviewer = "claude" | "opencode";

const INVOCATION_FOR_REVIEWER: Record<
  CliBinaryReviewer,
  Readonly<{ binary: string; leadingArgs: readonly string[] }>
> = {
  claude: { binary: "claude", leadingArgs: ["-p"] },
  opencode: { binary: "opencode", leadingArgs: ["run"] },
};

const SECRET_PATTERNS = [
  /KEY$/i,
  /TOKEN$/i,
  /SECRET$/i,
  /PASSWORD$/i,
  /_KEY$/i,
  /_TOKEN$/i,
  /_SECRET$/i,
  /_PASSWORD$/i,
];

const sanitizeEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => !value || !SECRET_PATTERNS.some((re) => re.test(key)),
    ),
  ) as NodeJS.ProcessEnv;

/* eslint-disable functional/immutable-data -- callback-based spawn needs mutable accumulator */
const spawnBinary = (
  binary: string,
  args: readonly string[],
  spawnFn: typeof spawn,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const child = spawnFn(binary, [...args], {
      env: { ...sanitizeEnv(), NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const acc = { stdout: "", stderr: "", settled: false };

    const cleanup = () => {
      if (typeof child?.kill !== "function") {
        process.stderr.write(
          `[agent-cya] cleanup: ${binary} child has unexpected shape ` +
            `(typeof child=${typeof child}, kill=${typeof child?.kill}, killed=${typeof child?.killed})\n`,
        );
        return;
      }
      if (!child.killed) child.kill("SIGTERM");
    };
    const timeout = setTimeout(() => {
      if (acc.settled) return;
      acc.settled = true;
      cleanup();
      reject(new Error(`${binary} timed out after ${SPAWN_TIMEOUT_MS}ms`));
    }, SPAWN_TIMEOUT_MS);
    timeout.unref();

    child.stdout.on("data", (data: Buffer) => {
      acc.stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      acc.stderr += data.toString();
    });

    child.on("close", (code) => {
      if (acc.settled) return;
      acc.settled = true;
      clearTimeout(timeout);
      if (code === 0 && acc.stdout.trim()) {
        resolve(acc.stdout.trim());
      } else {
        reject(
          new Error(
            `${binary} exited ${code}: ${acc.stderr.trim() || "no output"}`,
          ),
        );
      }
    });

    child.on("error", (err) => {
      if (acc.settled) return;
      acc.settled = true;
      clearTimeout(timeout);
      cleanup();
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        process.stderr.write(
          `[agent-cya] ENOENT looking up '${binary}' (PATH=${process.env.PATH ?? "<unset>"})\n`,
        );
      }
      reject(new Error(`Failed to spawn ${binary}: ${err.message}`));
    });
  });
};
/* eslint-enable functional/immutable-data */

type SpawnOutcome = Readonly<{ raw: string } | { error: string }>;

const attemptSpawn = (
  binary: string,
  args: readonly string[],
  spawnFn: typeof spawn,
): Promise<SpawnOutcome> =>
  spawnBinary(binary, args, spawnFn)
    .then((raw): SpawnOutcome => ({ raw }))
    .catch(
      (err): SpawnOutcome => ({
        error: err instanceof Error ? err.message : String(err),
      }),
    );

export const reviewViaCliBinary = async (
  input: Readonly<ReviewInput>,
  reviewer: CliBinaryReviewer,
  spawnFn: typeof spawn = spawn,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<LlmDecision> => {
  const invocation = INVOCATION_FOR_REVIEWER[reviewer];
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);
  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
  const args = [...invocation.leadingArgs, fullPrompt];

  const first = await attemptSpawn(invocation.binary, args, spawnFn);
  const final: SpawnOutcome =
    "raw" in first || first.error.includes("timed out")
      ? first
      : await (async () => {
          process.stderr.write(
            `[agent-cya] retrying ${invocation.binary} after: ${first.error}\n`,
          );
          await sleepFn(RETRY_DELAY_MS);
          return attemptSpawn(invocation.binary, args, spawnFn);
        })();

  if ("raw" in final) return parseLlmResponse(final.raw);

  process.stderr.write(
    `[agent-cya] LLM review failed (${invocation.binary}): ${final.error}\n`,
  );
  return {
    decision: "ask",
    reason: `LLM unavailable (${invocation.binary}: ${final.error})`,
  };
};
