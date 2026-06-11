/** Hard deny regex patterns — obviously destructive or exfiltrating commands */
const HARD_DENY_PATTERNS: readonly string[] = [
  "rm\\s+-[a-z]*r[a-z]*\\s+(/|/tmp|/var|/usr|/etc)",
  "rm\\s+-rf\\s+\\.",
  "rm\\s+-rf\\s+\\*",
  "\\b(mkfs(\\.\\w+)?|fdisk|dd)\\s",
  ":\\(\\)\\{",
  "(curl|wget|fetch)\\s+.*\\|\\s*(sh|bash|zsh)",
  "^export\\b(\\s*$|\\s*[|>]|\\s+-p\\b)",
  "^env\\b(\\s*$|\\s*[|>])",
  "^printenv\\b(\\s*$|\\s*[|>])",
  "^sudo\\b",
  "^su\\s",
];

export type RuleResult = {
  decision: "deny";
  reason: string;
};

export const evaluateHardDeny = (command: string): RuleResult | null => {
  const matched = HARD_DENY_PATTERNS.find((pattern) =>
    new RegExp(pattern).test(command),
  );
  if (matched) {
    return {
      decision: "deny",
      reason: `Command matches denied pattern: ${matched}`,
    };
  }
  return null;
};
