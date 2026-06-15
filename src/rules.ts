import { parse, type Parsed } from "./bash-ast.ts";

export type RuleResult = {
  decision: "deny" | "ask";
  reason: string;
};

type RuleFn = (node: Parsed) => RuleResult | null;

const hasFlagLetter = (args: readonly string[], letter: string): boolean =>
  args.some(
    (a) => a.startsWith("-") && !a.startsWith("--") && a.includes(letter),
  );

const hasFlagBoth = (args: readonly string[], a: string, b: string): boolean =>
  args.some(
    (arg) =>
      arg.startsWith("-") &&
      !arg.startsWith("--") &&
      arg.includes(a) &&
      arg.includes(b),
  );

const ABS_DANGER_PATH = /^\/(tmp|var|usr|etc)?(\/.*)?$/;

const ruleRmAbsPath: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "rm") return null;
  if (!hasFlagLetter(node.args, "r") && !hasFlagLetter(node.args, "R"))
    return null;
  if (!node.args.some((a) => ABS_DANGER_PATH.test(a))) return null;
  return {
    decision: "deny",
    reason: "rm with -r/-R against a system path (/, /tmp, /var, /usr, /etc)",
  };
};

const ruleRmDot: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "rm") return null;
  if (!hasFlagBoth(node.args, "r", "f")) return null;
  if (!node.args.includes(".")) return null;
  return { decision: "deny", reason: "rm -rf against the current directory" };
};

const ruleRmStar: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "rm") return null;
  if (!hasFlagBoth(node.args, "r", "f")) return null;
  if (!node.args.includes("*")) return null;
  return { decision: "deny", reason: "rm -rf against unquoted *" };
};

const ruleFilesystemTools: RuleFn = (node) => {
  if (node.type !== "simple") return null;
  if (!/^(mkfs(\.\w+)?|fdisk|dd)$/.test(node.name)) return null;
  return {
    decision: "deny",
    reason: `${node.name} can destroy filesystems or raw devices`,
  };
};

const ruleForkBomb: RuleFn = (node) => {
  if (node.type !== "function" || node.name !== ":") return null;
  return { decision: "deny", reason: "fork-bomb function definition (`:`)" };
};

const SHELL_TARGETS = new Set(["sh", "bash", "zsh"]);
const NET_FETCHERS = new Set(["curl", "wget", "fetch"]);

const ruleCurlPipedToShell: RuleFn = (node) => {
  if (node.type !== "pipeline") return null;
  const stages = node.stages;
  const last = stages[stages.length - 1];
  if (!last || last.type !== "simple" || !SHELL_TARGETS.has(last.name))
    return null;
  const earlier = stages.slice(0, -1);
  const hasFetcher = earlier.some(
    (s) => s.type === "simple" && NET_FETCHERS.has(s.name),
  );
  if (!hasFetcher) return null;
  return {
    decision: "deny",
    reason: "network fetch piped directly to a shell (curl|wget|fetch | sh)",
  };
};

const ruleExportDump: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "export") return null;
  if (node.args.includes("-p")) {
    return { decision: "deny", reason: "bare/`-p` export dumps environment" };
  }
  if (node.args.length === 0 && node.assignments.length === 0) {
    return { decision: "deny", reason: "bare/`-p` export dumps environment" };
  }
  return null;
};

const ruleEnvDump: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "env") return null;
  if (node.args.length === 0) {
    return { decision: "deny", reason: "bare `env` dumps environment" };
  }
  return null;
};

const rulePrintenvDump: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "printenv") return null;
  if (node.args.length === 0) {
    return { decision: "deny", reason: "bare `printenv` dumps environment" };
  }
  return null;
};

const ruleSudo: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "sudo") return null;
  return { decision: "deny", reason: "sudo escalates privileges" };
};

const ruleSu: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "su") return null;
  if (node.args.length === 0) return null;
  return { decision: "deny", reason: "su switches user context" };
};

const TRANSLATED_RULES: readonly RuleFn[] = [
  ruleRmAbsPath,
  ruleRmDot,
  ruleRmStar,
  ruleFilesystemTools,
  ruleForkBomb,
  ruleCurlPipedToShell,
  ruleExportDump,
  ruleEnvDump,
  rulePrintenvDump,
  ruleSudo,
  ruleSu,
];

const ALL_RULES: readonly RuleFn[] = [...TRANSLATED_RULES];

/**
 * Walk the AST, returning every `Parsed` node we want a rule to evaluate
 * against (Simple, Pipeline, Function, plus the bodies of List and Subshell).
 */
const walk = (node: Parsed): Parsed[] => {
  switch (node.type) {
    case "simple":
    case "unknown":
      return [node];
    case "pipeline":
      return [node, ...node.stages.flatMap(walk)];
    case "list":
      return node.children.flatMap(walk);
    case "subshell":
      return walk(node.body);
    case "function":
      return [node, ...walk(node.body)];
  }
};

const SEVERITY: Record<RuleResult["decision"], number> = { deny: 2, ask: 1 };

/* eslint-disable functional/no-let, functional/no-loop-statements -- iterative rule evaluation with short-circuit on deny */
export const evaluateRules = (command: string): RuleResult | null => {
  const parsed = parse(command);
  if (parsed === null) return null;

  let best: RuleResult | null = null;
  for (const node of walk(parsed)) {
    for (const rule of ALL_RULES) {
      const result = rule(node);
      if (result === null) continue;
      if (
        best === null ||
        SEVERITY[result.decision] > SEVERITY[best.decision]
      ) {
        best = result;
        if (best.decision === "deny") return best; // can't beat deny
      }
    }
  }
  return best;
};
/* eslint-enable functional/no-let, functional/no-loop-statements */
