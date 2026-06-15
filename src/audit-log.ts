import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_AUDIT_PATH = join(homedir(), ".agent-cya", "audit.log");
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

type AuditBase = {
  timestamp: string;
  tool: string;
  command: string;
  decision: "allow" | "deny" | "ask";
  reason: string;
};

export type AuditEntry =
  | (AuditBase & { source: "rule" })
  | (AuditBase & { source: "llm"; reviewer: string });

export type AuditLogger = {
  write(entry: Readonly<AuditEntry>): void;
};

const getMaxBytes = (): number => {
  const raw = process.env.AGENT_CYA_AUDIT_MAX_BYTES;
  if (raw === undefined) return DEFAULT_MAX_BYTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
};

const fileSize = (path: string): number => {
  try {
    return statSync(path).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
};

const rotateIfNeeded = (logPath: string, nextEntryBytes: number): void => {
  const maxBytes = getMaxBytes();
  if (fileSize(logPath) + nextEntryBytes <= maxBytes) return;
  try {
    renameSync(logPath, `${logPath}.1`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[agent-cya] audit rotate failed (${logPath}): ${message}\n`,
    );
  }
};

export const createAuditLogger = (
  logPath: string = DEFAULT_AUDIT_PATH,
): AuditLogger => {
  return {
    write(entry: Readonly<AuditEntry>): void {
      try {
        mkdirSync(dirname(logPath), { recursive: true });
        const line = JSON.stringify(entry) + "\n";
        rotateIfNeeded(logPath, Buffer.byteLength(line, "utf-8"));
        appendFileSync(logPath, line, "utf-8");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[agent-cya] audit write failed (${logPath}): ${message}\n`,
        );
      }
    },
  };
};
