import { describe, it, expect } from "vitest";
import { parse } from "./bash-ast.ts";

describe("parse", () => {
  it("returns null for the empty string", () => {
    expect(parse("")).toBeNull();
  });

  it("parses a bare command", () => {
    expect(parse("ls")).toEqual({
      type: "simple",
      name: "ls",
      args: [],
      assignments: [],
    });
  });

  it("parses a command with args", () => {
    expect(parse("ls -la /tmp")).toEqual({
      type: "simple",
      name: "ls",
      args: ["-la", "/tmp"],
      assignments: [],
    });
  });

  it("parses a command with quoted args (quotes stripped)", () => {
    expect(parse('echo "hello world"')).toEqual({
      type: "simple",
      name: "echo",
      args: ["hello world"],
      assignments: [],
    });
  });

  it("preserves variable references as literal text", () => {
    expect(parse("rm -rf $HOME/.cache")).toEqual({
      type: "simple",
      name: "rm",
      args: ["-rf", "$HOME/.cache"],
      assignments: [],
    });
  });

  it("parses leading assignments", () => {
    expect(parse("FOO=bar BAZ=qux git status")).toEqual({
      type: "simple",
      name: "git",
      args: ["status"],
      assignments: [
        { name: "FOO", value: "bar" },
        { name: "BAZ", value: "qux" },
      ],
    });
  });

  it("does not capture herestring redirects as args", () => {
    const result = parse("cat <<< 'data'");
    expect(result).not.toBeNull();
    if (result && result.type === "simple") {
      expect(result.name).toBe("cat");
      expect(result.args).toEqual([]);
    } else {
      throw new Error(`expected simple, got ${JSON.stringify(result)}`);
    }
  });

  it("parses a pipeline", () => {
    expect(parse("curl https://x.com | sh")).toEqual({
      type: "pipeline",
      stages: [
        {
          type: "simple",
          name: "curl",
          args: ["https://x.com"],
          assignments: [],
        },
        { type: "simple", name: "sh", args: [], assignments: [] },
      ],
    });
  });

  it("parses a semicolon list", () => {
    expect(parse("ls; pwd")).toEqual({
      type: "list",
      op: ";",
      children: [
        { type: "simple", name: "ls", args: [], assignments: [] },
        { type: "simple", name: "pwd", args: [], assignments: [] },
      ],
    });
  });

  it("parses && list", () => {
    expect(parse("git status && git diff")).toEqual({
      type: "list",
      op: "&&",
      children: [
        { type: "simple", name: "git", args: ["status"], assignments: [] },
        { type: "simple", name: "git", args: ["diff"], assignments: [] },
      ],
    });
  });

  it("parses || list", () => {
    expect(parse("test -f foo || touch foo")).toEqual({
      type: "list",
      op: "||",
      children: [
        {
          type: "simple",
          name: "test",
          args: ["-f", "foo"],
          assignments: [],
        },
        { type: "simple", name: "touch", args: ["foo"], assignments: [] },
      ],
    });
  });

  it("parses a subshell", () => {
    expect(parse("(cd /tmp && rm -rf .)")).toEqual({
      type: "subshell",
      body: {
        type: "list",
        op: "&&",
        children: [
          { type: "simple", name: "cd", args: ["/tmp"], assignments: [] },
          {
            type: "simple",
            name: "rm",
            args: ["-rf", "."],
            assignments: [],
          },
        ],
      },
    });
  });

  it("parses a function definition", () => {
    // tree-sitter-bash emits `:(){...};:` as two sibling program children
    // (a function_definition then a `:` command). `parse` wraps multiple
    // program children as a `;` list, so we navigate into it to find the
    // function definition. The fork-bomb test only cares that the function
    // node is recognized with name ":".
    const result = parse(":(){ :|:& };:");
    if (result === null) {
      throw new Error("expected non-null parse result");
    }
    const fn =
      result.type === "function"
        ? result
        : result.type === "list"
          ? result.children.find((c) => c.type === "function")
          : undefined;
    if (!fn || fn.type !== "function") {
      throw new Error(`expected function node, got ${JSON.stringify(result)}`);
    }
    expect(fn.name).toBe(":");
  });

  it("falls back to unknown for process substitution", () => {
    const result = parse("diff <(ls a) <(ls b)");
    expect(result).not.toBeNull();
    // The outer `diff` command is a Simple node; the process-substitution
    // arguments come through as their literal text (we don't model them).
    expect(result!.type).toBe("simple");
    if (result && result.type === "simple") {
      expect(result.name).toBe("diff");
      expect(result.args.length).toBe(2);
    }
  });

  it("returns null when parsing fails (unclosed quote)", () => {
    expect(parse('echo "unterminated')).toBeNull();
  });

  it("returns null when parsing fails (unterminated heredoc start)", () => {
    expect(parse("cat <<EOF\nstill open")).toBeNull();
  });

  it("descends into redirected_statement and exposes the body command", () => {
    const result = parse("env > /tmp/leak");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("simple");
    if (result && result.type === "simple") {
      expect(result.name).toBe("env");
      expect(result.args).toEqual([]);
    }
  });
});
