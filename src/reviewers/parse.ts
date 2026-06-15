export type LlmDecision = {
  decision: "allow" | "deny" | "ask";
  reason: string;
};

const extractJson = (raw: string): string => {
  const trimmed = raw.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
};

export const parseLlmResponse = (raw: string): LlmDecision => {
  try {
    const jsonStr = extractJson(raw);
    const parsed = JSON.parse(jsonStr);
    const decision = parsed.decision;
    if (decision !== "allow" && decision !== "deny" && decision !== "ask") {
      return { decision: "ask", reason: "Invalid LLM response, needs review" };
    }
    const reason =
      typeof parsed.reason === "string" ? parsed.reason : "No reason provided";
    return { decision, reason };
  } catch {
    return { decision: "ask", reason: "Invalid LLM response, needs review" };
  }
};
