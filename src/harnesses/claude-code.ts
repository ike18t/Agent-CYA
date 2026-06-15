import type { Command } from "commander";
import type { ReviewInput } from "../reviewers/prompt.ts";
import type { LlmDecision } from "../reviewers/parse.ts";
import { evaluate, type Reviewer } from "../pipeline.ts";
import { safeHarnessReviewer } from "../reviewers/config.ts";

type ClaudeCodeHookInput = Readonly<{
  tool_name?: string;
  tool_input?: Readonly<Record<string, unknown>>;
  cwd?: string;
}>;

export const parseClaudeCodeHookInput = (raw: string): ReviewInput => {
  const parsed: ClaudeCodeHookInput = JSON.parse(raw);
  const toolType = parsed.tool_name;
  if (!toolType || typeof toolType !== "string") {
    throw new Error("missing or invalid 'tool_name' in hook input");
  }
  const toolInput = parsed.tool_input ?? {};
  const workingDirectory =
    typeof parsed.cwd === "string" ? parsed.cwd : undefined;

  if (toolType === "Bash") {
    return {
      toolType,
      command: String(toolInput.command ?? ""),
      fileContent: null,
      workingDirectory,
    };
  }
  if (toolType === "Write") {
    return {
      toolType,
      command: String(toolInput.file_path ?? ""),
      fileContent:
        typeof toolInput.content === "string" ? toolInput.content : null,
      workingDirectory,
    };
  }
  if (toolType === "Edit") {
    return {
      toolType,
      command: String(toolInput.file_path ?? ""),
      fileContent: JSON.stringify({
        old_string: toolInput.old_string ?? null,
        new_string: toolInput.new_string ?? null,
      }),
      workingDirectory,
    };
  }
  return {
    toolType,
    command: String(toolInput.command ?? toolInput.file_path ?? ""),
    fileContent: null,
    workingDirectory,
  };
};

export const formatClaudeCodeHookOutput = (
  decision: Readonly<LlmDecision>,
): string =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: decision.decision,
        reason: decision.reason,
      },
    },
  });

export const exitCodeForDecision = (decision: Readonly<LlmDecision>): number =>
  decision.decision === "deny" ? 2 : 0;

export const resolveHookReviewer = (
  flagReviewer: Reviewer | undefined,
): Reviewer => flagReviewer ?? safeHarnessReviewer("claudeCode") ?? "claude";

/* eslint-disable functional/no-let, functional/no-loop-statements -- for await is the only stack-safe way to read stdin */
const readStdin = async (): Promise<string> => {
  let acc = "";
  for await (const chunk of process.stdin) acc += chunk.toString();
  return acc;
};
/* eslint-enable functional/no-let, functional/no-loop-statements */

const runHook = async (
  stdinRaw: string,
  reviewer: Reviewer,
  minAskMs: number,
): Promise<number> => {
  try {
    const input = parseClaudeCodeHookInput(stdinRaw);
    const { decision } = await evaluate(input, reviewer, minAskMs);
    process.stdout.write(formatClaudeCodeHookOutput(decision) + "\n");
    return exitCodeForDecision(decision);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[agent-cya] ${message}\n`);
    process.stdout.write(
      formatClaudeCodeHookOutput({
        decision: "ask",
        reason: `agent-cya error: ${message}`,
      }) + "\n",
    );
    return 1;
  }
};

export const registerHookCommand = (parent: Command): void => {
  parent
    .command("claude-code")
    .description(
      "Run as a Claude Code PermissionRequest hook (reads/writes Claude Code's hook format)",
    )
    .action(async (_options, command: Command) => {
      const globals = command.optsWithGlobals();
      const flagReviewer = globals.reviewer as Reviewer | undefined;
      const reviewer = resolveHookReviewer(flagReviewer);
      const minAskMs = globals.minAskMs as number;
      const stdin = await readStdin();
      const exitCode = await runHook(stdin, reviewer, minAskMs);
      process.exit(exitCode);
    });
};
