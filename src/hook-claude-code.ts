import type { ReviewInput } from "./prompt.ts";
import type { LlmDecision } from "./llm.ts";

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
  const ti = parsed.tool_input ?? {};
  const workingDirectory =
    typeof parsed.cwd === "string" ? parsed.cwd : undefined;

  if (toolType === "Bash") {
    return {
      toolType,
      command: String(ti.command ?? ""),
      fileContent: null,
      workingDirectory,
    };
  }
  if (toolType === "Write") {
    return {
      toolType,
      command: String(ti.file_path ?? ""),
      fileContent: typeof ti.content === "string" ? ti.content : null,
      workingDirectory,
    };
  }
  if (toolType === "Edit") {
    return {
      toolType,
      command: String(ti.file_path ?? ""),
      fileContent: JSON.stringify({
        old_string: ti.old_string ?? null,
        new_string: ti.new_string ?? null,
      }),
      workingDirectory,
    };
  }
  return {
    toolType,
    command: String(ti.command ?? ti.file_path ?? ""),
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
