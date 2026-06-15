import { parse, type Parsed } from "./bash-ast.ts";

export type RuleResult = {
  decision: "deny" | "ask";
  reason: string;
};

type RuleFn = (node: Parsed) => RuleResult | null;

const LONG_FLAGS_FOR_LETTER: Readonly<Record<string, readonly string[]>> = {
  r: ["--recursive"],
  R: ["--recursive"],
  f: ["--force"],
};

const hasFlagLetter = (args: readonly string[], letter: string): boolean => {
  const longForms = LONG_FLAGS_FOR_LETTER[letter] ?? [];
  return args.some(
    (a) =>
      (a.startsWith("-") && !a.startsWith("--") && a.includes(letter)) ||
      longForms.includes(a),
  );
};

const hasFlagBoth = (args: readonly string[], a: string, b: string): boolean =>
  hasFlagLetter(args, a) && hasFlagLetter(args, b);

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

const isGitSub = (node: Parsed, sub: string | readonly string[]): boolean => {
  if (node.type !== "simple" || node.name !== "git") return false;
  const subs = Array.isArray(sub) ? sub : [sub];
  return subs.includes(node.args[0] ?? "");
};

const ruleGitPushForce: RuleFn = (node) => {
  if (!isGitSub(node, "push") || node.type !== "simple") return null;
  const hasLease = node.args.includes("--force-with-lease");
  const hasForce = node.args.includes("--force") || node.args.includes("-f");
  if (!hasForce || hasLease) return null;
  return {
    decision: "deny",
    reason:
      "git push --force rewrites remote history without a remote-state check; use --force-with-lease if intentional",
  };
};

const ruleGitPushForceWithLease: RuleFn = (node) => {
  if (!isGitSub(node, "push") || node.type !== "simple") return null;
  if (!node.args.includes("--force-with-lease")) return null;
  return {
    decision: "ask",
    reason:
      "git push --force-with-lease rewrites history; verify branch and that no downstream work depends on the prior tip",
  };
};

const ruleGitResetHard: RuleFn = (node) => {
  if (!isGitSub(node, "reset") || node.type !== "simple") return null;
  if (!node.args.includes("--hard")) return null;
  return {
    decision: "ask",
    reason:
      "git reset --hard discards uncommitted changes in the working tree and index",
  };
};

const ruleGitClean: RuleFn = (node) => {
  if (!isGitSub(node, "clean") || node.type !== "simple") return null;
  if (!hasFlagLetter(node.args, "f")) return null;
  return {
    decision: "ask",
    reason:
      "git clean -f deletes untracked files (-d includes directories, -x includes ignored files)",
  };
};

const ruleGitBranchForceDelete: RuleFn = (node) => {
  if (!isGitSub(node, "branch") || node.type !== "simple") return null;
  const dashCapD = node.args.includes("-D");
  const deleteForce =
    node.args.includes("--delete") && node.args.includes("--force");
  if (!dashCapD && !deleteForce) return null;
  return {
    decision: "ask",
    reason:
      "git branch -D force-deletes a branch ref without checking merged status",
  };
};

const ruleGitFilter: RuleFn = (node) => {
  if (
    !isGitSub(node, ["filter-branch", "filter-repo"]) ||
    node.type !== "simple"
  )
    return null;
  return {
    decision: "ask",
    reason: `${node.args[0]} rewrites every commit matching the filter; non-trivial to recover from`,
  };
};

const NPM_LIKE = new Set(["npm", "pnpm", "yarn"]);

const ruleNpmPublish: RuleFn = (node) => {
  if (node.type !== "simple") return null;
  if (!NPM_LIKE.has(node.name)) return null;
  if (node.args[0] !== "publish") return null;
  return {
    decision: "ask",
    reason: `${node.name} publish releases to a public registry; effect persists beyond this machine`,
  };
};

const ruleCargoPublish: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "cargo") return null;
  if (node.args[0] !== "publish") return null;
  return { decision: "ask", reason: "cargo publish releases to crates.io" };
};

const ruleGhRepoDelete: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "gh") return null;
  if (node.args[0] !== "repo" || node.args[1] !== "delete") return null;
  return {
    decision: "ask",
    reason:
      "gh repo delete removes a GitHub repository (not recoverable from this CLI)",
  };
};

const ruleGhReleaseDelete: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "gh") return null;
  if (node.args[0] !== "release" || node.args[1] !== "delete") return null;
  return {
    decision: "ask",
    reason: "gh release delete removes a GitHub release",
  };
};

const ruleGhSecretRemove: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "gh") return null;
  if (node.args[0] !== "secret") return null;
  if (node.args[1] !== "remove" && node.args[1] !== "delete") return null;
  return {
    decision: "ask",
    reason: `gh secret ${node.args[1]} removes a repository or organization secret`,
  };
};

const ruleGhRepoCreatePublic: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "gh") return null;
  if (node.args[0] !== "repo" || node.args[1] !== "create") return null;
  if (!node.args.includes("--public")) return null;
  return {
    decision: "ask",
    reason:
      "gh repo create --public creates a publicly-visible GitHub repository",
  };
};

const ruleDockerRm: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "docker") return null;
  if (node.args[0] !== "rm" && node.args[0] !== "rmi") return null;
  return {
    decision: "ask",
    reason: `docker ${node.args[0]} removes Docker containers or images`,
  };
};

const ruleDockerVolumeRm: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "docker") return null;
  if (node.args[0] !== "volume" || node.args[1] !== "rm") return null;
  return {
    decision: "ask",
    reason: "docker volume rm removes a Docker volume (data loss)",
  };
};

const ruleDockerSystemPrune: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "docker") return null;
  if (node.args[0] !== "system" || node.args[1] !== "prune") return null;
  return {
    decision: "ask",
    reason: "docker system prune removes unused Docker resources cluster-wide",
  };
};

const ruleKubectlDelete: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "kubectl") return null;
  if (node.args[0] !== "delete") return null;
  return {
    decision: "ask",
    reason: "kubectl delete removes resources from the cluster",
  };
};

const ruleKubectlDrain: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "kubectl") return null;
  if (node.args[0] !== "drain") return null;
  return { decision: "ask", reason: "kubectl drain evicts pods from a node" };
};

const ruleChmod777: RuleFn = (node) => {
  if (node.type !== "simple" || node.name !== "chmod") return null;
  // Match world-writable modes: 777, 0777, plus sticky/setgid/setuid variants
  // (1777, 2777, 4777, etc.). The pattern accepts an optional leading 0-7 digit
  // before the 777 trailer.
  if (!node.args.some((a) => /^[0-7]?777$/.test(a))) return null;
  return {
    decision: "ask",
    reason:
      "chmod with world-writable mode (777 or sticky/setuid variants); verify this is actually necessary",
  };
};

const ALL_RULES: readonly RuleFn[] = [
  ...TRANSLATED_RULES,
  ruleGitPushForce,
  ruleGitPushForceWithLease,
  ruleGitResetHard,
  ruleGitClean,
  ruleGitBranchForceDelete,
  ruleGitFilter,
  ruleNpmPublish,
  ruleCargoPublish,
  ruleGhRepoDelete,
  ruleGhReleaseDelete,
  ruleGhSecretRemove,
  ruleGhRepoCreatePublic,
  ruleDockerRm,
  ruleDockerVolumeRm,
  ruleDockerSystemPrune,
  ruleKubectlDelete,
  ruleKubectlDrain,
  ruleChmod777,
];

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
