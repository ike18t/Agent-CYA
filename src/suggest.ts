import { existsSync } from "node:fs";
import { Command, Option } from "commander";
import {
  readAuditEntries,
  DEFAULT_AUDIT_LOG,
  type AuditEntry,
} from "./audit-log.ts";

type Suggestion = Readonly<{
  command: string;
  allows: number;
  lastSeen: string;
}>;

type Cluster = Readonly<{
  prefix: string;
  variantCount: number;
  totalAllows: number;
}>;

export type SuggestResult = Readonly<{
  suggestions: ReadonlyArray<Suggestion>;
  clusters: ReadonlyArray<Cluster>;
}>;

type Bucket = { allows: number; denies: number; lastSeen: string };

const MAX_CLUSTERS = 10;

const normalize = (command: string): string =>
  command.trim().replace(/\s+/g, " ");

const firstTwoTokens = (command: string): string =>
  command.split(" ").slice(0, 2).join(" ");

const buildBuckets = (
  entries: Iterable<AuditEntry>,
): ReadonlyMap<string, Bucket> => {
  const counted = Array.from(entries).filter(
    (entry) =>
      entry.tool === "Bash" &&
      (entry.decision === "allow" || entry.decision === "deny"),
  );
  const grouped = Object.groupBy(counted, (entry) => normalize(entry.command));
  return new Map(
    Object.entries(grouped).map(([key, group]) => [
      key,
      (group ?? []).reduce<Bucket>(
        (b, e) => ({
          allows: b.allows + (e.decision === "allow" ? 1 : 0),
          denies: b.denies + (e.decision === "deny" ? 1 : 0),
          // ISO 8601 strings sort lexicographically, so > gives chronological max.
          lastSeen: e.timestamp > b.lastSeen ? e.timestamp : b.lastSeen,
        }),
        { allows: 0, denies: 0, lastSeen: "" },
      ),
    ]),
  );
};

const buildSuggestions = (
  buckets: ReadonlyMap<string, Bucket>,
  minAllows: number,
): ReadonlyArray<Suggestion> =>
  Array.from(buckets)
    .filter(([, b]) => b.allows >= minAllows && b.denies === 0)
    .map(([command, b]) => ({
      command,
      allows: b.allows,
      lastSeen: b.lastSeen,
    }))
    .sort((a, b) =>
      b.allows !== a.allows
        ? b.allows - a.allows
        : a.command < b.command
          ? -1
          : 1,
    );

const buildClusters = (
  buckets: ReadonlyMap<string, Bucket>,
  minAllows: number,
): ReadonlyArray<Cluster> => {
  const eligible = Array.from(buckets).filter(
    ([command, b]) =>
      b.denies === 0 &&
      b.allows < minAllows &&
      firstTwoTokens(command) !== command,
  );
  const grouped = Object.groupBy(eligible, ([command]) =>
    firstTwoTokens(command),
  );
  return Object.entries(grouped)
    .map(([prefix, group]) => ({
      prefix,
      variantCount: (group ?? []).length,
      totalAllows: (group ?? []).reduce((sum, [, b]) => sum + b.allows, 0),
    }))
    .filter((g) => g.variantCount >= 3 && g.totalAllows >= minAllows)
    .sort((a, b) => b.totalAllows - a.totalAllows)
    .slice(0, MAX_CLUSTERS);
};

export const aggregate = (
  entries: Iterable<AuditEntry>,
  opts: Readonly<{ minAllows: number }>,
): SuggestResult => {
  const buckets = buildBuckets(entries);
  const suggestions = buildSuggestions(buckets, opts.minAllows);
  const clusters = buildClusters(buckets, opts.minAllows);
  return { suggestions, clusters };
};

export const formatJson = (
  result: Readonly<SuggestResult>,
  scannedEntries: number,
): string =>
  JSON.stringify(
    {
      scannedEntries,
      suggestions: result.suggestions,
      clusters: result.clusters,
    },
    null,
    2,
  ) + "\n";

type FormatTextOptions = Readonly<{
  now: number;
  minAllows: number;
  rotatedScanned?: boolean;
}>;

const ONE_MINUTE = 60 * 1000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_MONTH = 30 * ONE_DAY;
const ONE_YEAR = 365 * ONE_DAY;

const humanize = (isoTimestamp: string, now: number): string => {
  const delta = now - Date.parse(isoTimestamp);
  if (delta < ONE_MINUTE) return "just now";
  if (delta < ONE_HOUR) return `${Math.floor(delta / ONE_MINUTE)}m ago`;
  if (delta < ONE_DAY) return `${Math.floor(delta / ONE_HOUR)}h ago`;
  if (delta < ONE_MONTH) return `${Math.floor(delta / ONE_DAY)}d ago`;
  if (delta < ONE_YEAR) return `${Math.floor(delta / ONE_MONTH)}mo ago`;
  return `${Math.floor(delta / ONE_YEAR)}y ago`;
};

const padRight = (s: string, width: number): string =>
  s.length >= width ? s : s + " ".repeat(width - s.length);

const padLeft = (s: string, width: number): string =>
  s.length >= width ? s : " ".repeat(width - s.length) + s;

const formatSuggestionRow = (
  s: Suggestion,
  commandWidth: number,
  allowsWidth: number,
  now: number,
): string =>
  `  ${padRight(s.command, commandWidth)}  ${padLeft(
    String(s.allows),
    allowsWidth,
  )} allows  last seen ${humanize(s.lastSeen, now)}`;

const formatClusterRow = (
  c: Cluster,
  prefixWidth: number,
  variantWidth: number,
  totalWidth: number,
): string =>
  `  ${padRight(c.prefix, prefixWidth)}  → ${padLeft(
    String(c.variantCount),
    variantWidth,
  )} variants, ${padLeft(String(c.totalAllows), totalWidth)} total allows`;

const renderSuggestionsBlock = (
  suggestions: ReadonlyArray<Suggestion>,
  minAllows: number,
  now: number,
): ReadonlyArray<string> => {
  if (suggestions.length === 0) return [];
  const commandWidth = Math.max(...suggestions.map((s) => s.command.length));
  const allowsWidth = Math.max(
    ...suggestions.map((s) => String(s.allows).length),
  );
  return [
    "",
    `Suggested commands (≥${minAllows} allows, 0 denies):`,
    ...suggestions.map((s) =>
      formatSuggestionRow(s, commandWidth, allowsWidth, now),
    ),
  ];
};

const renderClustersBlock = (
  clusters: ReadonlyArray<Cluster>,
): ReadonlyArray<string> => {
  if (clusters.length === 0) return [];
  const prefixWidth = Math.max(...clusters.map((c) => c.prefix.length));
  const variantWidth = Math.max(
    ...clusters.map((c) => String(c.variantCount).length),
  );
  const totalWidth = Math.max(
    ...clusters.map((c) => String(c.totalAllows).length),
  );
  return [
    "",
    "Clusters worth reviewing manually:",
    ...clusters.map((c) =>
      formatClusterRow(c, prefixWidth, variantWidth, totalWidth),
    ),
  ];
};

export const formatText = (
  result: Readonly<SuggestResult>,
  scannedEntries: number | null,
  logPath: string,
  opts: FormatTextOptions,
): string => {
  if (scannedEntries === null) {
    return `No audit log found at ${logPath} — nothing to suggest yet.\n`;
  }
  const rotatedNote = opts.rotatedScanned ? " (+1 rotated)" : "";
  const header = `Scanned ${scannedEntries} Bash entries from ${logPath}${rotatedNote}.`;

  if (result.suggestions.length === 0 && result.clusters.length === 0) {
    return [
      header,
      "",
      "No suggestions yet — keep using AgentCYA and try again later.",
      "",
    ].join("\n");
  }

  return [
    header,
    ...renderSuggestionsBlock(result.suggestions, opts.minAllows, opts.now),
    ...renderClustersBlock(result.clusters),
    "",
    "Copy individual commands into your harness allowlist;",
    "for clusters, consider a wildcard pattern after review.",
    "",
  ].join("\n");
};

const DEFAULT_MIN_ALLOWS = 5;

/* eslint-disable functional/no-loop-statements, functional/immutable-data -- draining an async iterable; Array.fromAsync isn't in the project's TS lib yet */
const drainAsync = async <T>(iter: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const item of iter) collected.push(item);
  return collected;
};
/* eslint-enable functional/no-loop-statements, functional/immutable-data */

export const runSuggest = async (
  opts: Readonly<{
    auditLog: string;
    json: boolean;
    minAllows: number;
  }>,
): Promise<void> => {
  const now = Date.now();
  if (!existsSync(opts.auditLog) && !existsSync(`${opts.auditLog}.1`)) {
    process.stdout.write(
      opts.json
        ? formatJson({ suggestions: [], clusters: [] }, 0)
        : formatText({ suggestions: [], clusters: [] }, null, opts.auditLog, {
            now,
            minAllows: opts.minAllows,
          }),
    );
    return;
  }

  const entries = await drainAsync(readAuditEntries(opts.auditLog));
  const scanned = entries.filter((e) => e.tool === "Bash").length;
  const result = aggregate(entries, { minAllows: opts.minAllows });

  process.stdout.write(
    opts.json
      ? formatJson(result, scanned)
      : formatText(result, scanned, opts.auditLog, {
          now,
          minAllows: opts.minAllows,
          rotatedScanned: existsSync(`${opts.auditLog}.1`),
        }),
  );
};

export const registerSuggestCommand = (parent: Command): void => {
  parent
    .command("suggest")
    .description(
      "Surface high-frequency, never-denied Bash commands from the audit log",
    )
    .addOption(
      new Option(
        "--min-allows <n>",
        "Minimum allow count for a command to be suggested",
      )
        .default(DEFAULT_MIN_ALLOWS)
        .argParser((v) => {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) {
            throw new Error(
              "--min-allows must be a non-negative finite number",
            );
          }
          return n;
        }),
    )
    .option("--json", "Emit structured JSON instead of a human table", false)
    .option(
      "--audit-log <path>",
      "Override the audit log path",
      DEFAULT_AUDIT_LOG,
    )
    .action(
      async (
        cmdOpts: Readonly<{
          minAllows: number;
          json: boolean;
          auditLog: string;
        }>,
      ) => {
        await runSuggest({
          auditLog: cmdOpts.auditLog,
          json: cmdOpts.json,
          minAllows: cmdOpts.minAllows,
        });
      },
    );
};
