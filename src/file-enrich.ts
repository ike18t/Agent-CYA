import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ReviewInput } from "./reviewers/prompt.ts";

const INTERPRETERS = new Set([
  "bash",
  "sh",
  "zsh",
  "ksh",
  "fish",
  "node",
  "deno",
  "bun",
  "tsx",
  "python",
  "python3",
  "py",
  "ruby",
  "perl",
  "pwsh",
  "powershell",
]);

const MAX_FILE_BYTES = 16_384;

export const extractScriptPath = (command: string): string | null => {
  const segment = command.split(/[;&|]+/)[0]?.trim() ?? "";
  const tokens = segment.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  const first = tokens[0];

  if (
    first.startsWith("./") ||
    first.startsWith("../") ||
    first.startsWith("/")
  ) {
    return first;
  }

  if (INTERPRETERS.has(first)) {
    const rest = tokens.slice(1);
    if (rest.some((t) => t === "-c" || t === "-e")) return null;
    return rest.find((t) => !t.startsWith("-")) ?? null;
  }

  return null;
};

const resolvePath = (
  candidate: string,
  workingDirectory: string | undefined,
): string | null => {
  if (isAbsolute(candidate)) return candidate;
  if (!workingDirectory) return null;
  return resolve(workingDirectory, candidate);
};

export const enrichBashFileContent = (
  input: Readonly<ReviewInput>,
): ReviewInput => {
  if (input.toolType !== "Bash") return input;
  if (input.fileContent != null) return input;

  const candidate = extractScriptPath(input.command);
  if (!candidate) return input;

  const fullPath = resolvePath(candidate, input.workingDirectory);
  if (!fullPath) return input;

  try {
    const stats = statSync(fullPath);
    if (!stats.isFile()) return input;

    if (stats.size > MAX_FILE_BYTES * 4) {
      return {
        ...input,
        fileContent: `[file too large to inspect: ${stats.size} bytes at ${fullPath}]`,
      };
    }

    const raw = readFileSync(fullPath, "utf8");
    const trimmed =
      raw.length > MAX_FILE_BYTES
        ? `${raw.slice(0, MAX_FILE_BYTES)}\n[truncated]`
        : raw;

    return {
      ...input,
      fileContent: `[content of ${fullPath}]\n${trimmed}`,
    };
  } catch {
    return input;
  }
};
