import { readFileSync } from "node:fs";
import { Command, Option } from "commander";
import { evaluate, type Reviewer } from "./pipeline.ts";
import { registerHookCommand } from "./harnesses/claude-code.ts";
import type { ReviewInput } from "./reviewers/prompt.ts";

const packageJson: Readonly<{ version: string }> = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

const program = new Command();

program
  .name("agent-cya")
  .description("CLI that reviews AI coding harness tool calls before execution")
  .version(packageJson.version)
  .addOption(
    new Option("--reviewer <reviewer>", "LLM Reviewer")
      .choices(["claude", "opencode", "openai"])
      .default("claude"),
  )
  .addOption(
    new Option(
      "--min-ask-ms <ms>",
      "Minimum ms to hold 'ask' decisions open for human review",
    )
      .default(0)
      .argParser((v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("--min-ask-ms must be a non-negative finite number");
        }
        return n;
      }),
  );

/* eslint-disable functional/no-let, functional/no-loop-statements -- for await is the only stack-safe way to read stdin */
const readStdin = async (): Promise<string> => {
  let acc = "";
  for await (const chunk of process.stdin) acc += chunk.toString();
  return acc;
};
/* eslint-enable functional/no-let, functional/no-loop-statements */

const parseInput = (raw: string): ReviewInput => {
  const parsed = JSON.parse(raw);
  const toolType = parsed.toolType;
  const command = parsed.command;

  if (!toolType || typeof toolType !== "string") {
    throw new Error("missing or invalid 'toolType' in input");
  }
  if (!command || typeof command !== "string") {
    throw new Error("missing or invalid 'command' in input");
  }

  return {
    toolType,
    command,
    fileContent:
      typeof parsed.fileContent === "string" ? parsed.fileContent : null,
    workingDirectory: parsed.workingDirectory,
  };
};

const runReview = async (
  stdinRaw: string,
  reviewer: Reviewer,
  minAskMs: number,
): Promise<number> => {
  try {
    const input = parseInput(stdinRaw);
    const { decision } = await evaluate(input, reviewer, minAskMs);
    process.stdout.write(JSON.stringify(decision) + "\n");
    return decision.decision === "deny" ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[agent-cya] ${message}\n`);
    return 1;
  }
};

program
  .command("review")
  .description("Review a tool call from stdin (agent-cya input format)")
  .action(async (_options, command: Command) => {
    const globals = command.optsWithGlobals();
    const reviewer = globals.reviewer as Reviewer;
    const minAskMs = globals.minAskMs as number;
    const stdin = await readStdin();
    const exitCode = await runReview(stdin, reviewer, minAskMs);
    process.exit(exitCode);
  });

const hook = program
  .command("hook")
  .description("Run as a harness permission hook");

registerHookCommand(hook);

export { runReview, parseInput, program };
