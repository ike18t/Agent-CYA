import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type OpenAIReviewerConfig = Readonly<{
  baseUrl: string;
  model: string;
  apiKey: string;
}>;

type RawOpenAIConfig = Readonly<{
  baseUrl: string;
  model: string;
  apiKey?: string;
  apiKeyCmd?: string;
}>;

const API_KEY_CMD_TIMEOUT_MS = 5_000;

const configPath = (): string => join(homedir(), ".agent-cya", "config.json");

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateOpenAISection = (raw: unknown, path: string): RawOpenAIConfig => {
  if (!isRecord(raw)) {
    throw new Error(
      `${path}: reviewers.openai must be an object (got ${typeof raw})`,
    );
  }
  if (!isNonEmptyString(raw.baseUrl)) {
    throw new Error(
      `${path}: reviewers.openai.baseUrl must be a non-empty string`,
    );
  }
  if (!isNonEmptyString(raw.model)) {
    throw new Error(
      `${path}: reviewers.openai.model must be a non-empty string`,
    );
  }
  const hasApiKey = isNonEmptyString(raw.apiKey);
  const hasApiKeyCmd = isNonEmptyString(raw.apiKeyCmd);
  if (!hasApiKey && !hasApiKeyCmd) {
    throw new Error(
      `${path}: reviewers.openai requires apiKey or apiKeyCmd (non-empty string)`,
    );
  }
  return {
    baseUrl: raw.baseUrl,
    model: raw.model,
    apiKey: hasApiKey ? (raw.apiKey as string) : undefined,
    apiKeyCmd: hasApiKeyCmd ? (raw.apiKeyCmd as string) : undefined,
  };
};

const parseConfigFile = (path: string): RawOpenAIConfig => {
  const contents = ((): string => {
    try {
      return readFileSync(path, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read config at ${path}: ${message}`);
    }
  })();

  const parsed = ((): unknown => {
    try {
      return JSON.parse(contents);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Malformed JSON in config at ${path}: ${message}`);
    }
  })();

  if (!isRecord(parsed)) {
    throw new Error(`${path}: config root must be an object`);
  }
  const reviewers = parsed.reviewers;
  if (!isRecord(reviewers)) {
    throw new Error(`${path}: missing 'reviewers' object`);
  }
  if (!("openai" in reviewers)) {
    throw new Error(`${path}: missing 'reviewers.openai' section`);
  }
  return validateOpenAISection(reviewers.openai, path);
};

const warnIfPermissive = (path: string): void => {
  if (process.platform === "win32") return;
  try {
    const mode = statSync(path).mode;
    if ((mode & 0o077) !== 0) {
      const octal = (mode & 0o777).toString(8).padStart(3, "0");
      process.stderr.write(
        `[agent-cya] warning: ${path} is mode ${octal}, recommend chmod 600\n`,
      );
    }
  } catch {
    // stat already failed in parseConfigFile if the file is missing; ignore
    // any racey failures here so warnings never block config loading.
  }
};

/* eslint-disable functional/immutable-data -- callback-based spawn needs mutable accumulator */
const runApiKeyCmd = (
  command: string,
  spawnFn: typeof spawn,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Pass process.env UNCHANGED: credential helpers (op, bw, vault, aws, etc.)
    // legitimately depend on OP_SESSION_*, BW_SESSION, VAULT_TOKEN,
    // AWS_SECRET_ACCESS_KEY, etc. — do NOT route this through sanitizeEnv.
    const child = spawnFn(command, [], {
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const acc = { stdout: "", stderr: "", settled: false };

    const cleanup = () => {
      if (typeof child?.kill !== "function") return;
      if (!child.killed) child.kill("SIGTERM");
    };

    const timeout = setTimeout(() => {
      if (acc.settled) return;
      acc.settled = true;
      cleanup();
      reject(
        new Error(`apiKeyCmd timed out after ${API_KEY_CMD_TIMEOUT_MS}ms`),
      );
    }, API_KEY_CMD_TIMEOUT_MS);
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
      if (code !== 0) {
        reject(
          new Error(
            `apiKeyCmd exited ${code}: ${acc.stderr.trim() || "no output"}`,
          ),
        );
        return;
      }
      const trimmed = acc.stdout.trim();
      if (!trimmed) {
        reject(new Error("apiKeyCmd produced empty output"));
        return;
      }
      resolve(trimmed);
    });

    child.on("error", (err) => {
      if (acc.settled) return;
      acc.settled = true;
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Failed to run apiKeyCmd: ${err.message}`));
    });
  });
};
/* eslint-enable functional/immutable-data */

export const loadOpenAIConfig = async (
  spawnFn: typeof spawn = spawn,
): Promise<OpenAIReviewerConfig> => {
  const path = configPath();
  const raw = parseConfigFile(path);
  warnIfPermissive(path);

  const resolvedApiKey = raw.apiKeyCmd
    ? await runApiKeyCmd(raw.apiKeyCmd, spawnFn)
    : (raw.apiKey as string);

  return {
    baseUrl: raw.baseUrl,
    model: raw.model,
    apiKey: resolvedApiKey,
  };
};
