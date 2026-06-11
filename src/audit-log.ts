import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_AUDIT_PATH = join(homedir(), ".agent-cya", "audit.log");

type AuditSource = "rule" | "llm";

export type AuditEntry = {
  timestamp: string;
  tool: string;
  command: string;
  decision: "allow" | "deny" | "ask";
  reason: string;
  source: AuditSource;
};

export type AuditLogger = {
  write(entry: Readonly<AuditEntry>): void;
};

export const createAuditLogger = (): AuditLogger => {
  const logPath = DEFAULT_AUDIT_PATH;

  return {
    write(entry: Readonly<AuditEntry>): void {
      try {
        mkdirSync(dirname(logPath), { recursive: true });
        appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[agent-cya] audit write failed (${logPath}): ${message}\n`,
        );
      }
    },
  };
};
