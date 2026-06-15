import { evaluateHardDeny } from "./rules.ts";
import { review } from "./llm.ts";
import { createAuditLogger } from "./audit-log.ts";
import { enrichBashFileContent } from "./file-enrich.ts";
import type { ReviewInput } from "./prompt.ts";
import type { LlmDecision } from "./llm.ts";

export type Reviewer = "claude" | "opencode" | "openai";

export type EvaluateResult =
  | Readonly<{ decision: LlmDecision; source: "rule" }>
  | Readonly<{ decision: LlmDecision; source: "llm"; reviewer: Reviewer }>;

type AuditTag = { source: "rule" } | { source: "llm"; reviewer: Reviewer };

const writeAudit = (
  input: Readonly<ReviewInput>,
  decision: Readonly<LlmDecision>,
  tag: Readonly<AuditTag>,
  audit: ReturnType<typeof createAuditLogger>,
): void => {
  audit.write({
    timestamp: new Date().toISOString(),
    tool: input.toolType,
    command: input.command,
    decision: decision.decision,
    reason: decision.reason,
    ...tag,
  });
};

export const evaluate = async (
  input: Readonly<ReviewInput>,
  reviewer: Reviewer,
): Promise<EvaluateResult> => {
  const audit = createAuditLogger();

  const denyResult = evaluateHardDeny(input.command);
  if (denyResult) {
    writeAudit(input, denyResult, { source: "rule" }, audit);
    return { decision: denyResult, source: "rule" };
  }

  const enriched = enrichBashFileContent(input);
  const decision = await review(enriched, reviewer);
  writeAudit(input, decision, { source: "llm", reviewer }, audit);
  return { decision, source: "llm", reviewer };
};
