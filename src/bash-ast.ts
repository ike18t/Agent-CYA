import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";

type Assign = { name: string; value: string };

export type Parsed =
  | { type: "simple"; name: string; args: string[]; assignments: Assign[] }
  | { type: "pipeline"; stages: Parsed[] }
  | { type: "list"; op: ";" | "&&" | "||"; children: Parsed[] }
  | { type: "subshell"; body: Parsed }
  | { type: "function"; name: string; body: Parsed }
  | { type: "unknown"; raw: string };

const parser = new Parser();
parser.setLanguage(Bash);

type Node = Parser.SyntaxNode;

const wordText = (node: Node): string => {
  // For `string` and `raw_string` we want the logical text with surrounding
  // quotes stripped. For everything else (`word`, `concatenation`,
  // `simple_expansion`, etc.) the raw text already preserves what we need,
  // including literal `$VAR` references.
  if (node.type === "string" || node.type === "raw_string") {
    return node.text.slice(1, -1);
  }
  return node.text;
};

const parseAssignment = (node: Node): Assign => {
  const nameNode = node.childForFieldName("name") ?? node.namedChild(0);
  const valueNode = node.childForFieldName("value") ?? node.namedChild(1);
  return {
    name: nameNode ? nameNode.text : "",
    value: valueNode ? wordText(valueNode) : "",
  };
};

/* eslint-disable functional/no-let, functional/no-loop-statements, functional/immutable-data -- tree-sitter CST traversal needs imperative accumulation */
const parseCommand = (node: Node): Parsed => {
  const assignments: Assign[] = [];
  let name = "";
  const args: string[] = [];

  for (const child of node.namedChildren) {
    if (child.type === "variable_assignment" && name === "") {
      assignments.push(parseAssignment(child));
      continue;
    }
    if (child.type === "command_name") {
      const inner = child.namedChild(0);
      name = inner ? wordText(inner) : child.text;
      continue;
    }
    // Everything else after command_name is an argument — except redirect
    // nodes (herestring/heredoc), which tree-sitter-bash emits as direct
    // namedChildren of `command`. Skip them; redirect modeling is out of
    // scope for v1.
    if (name !== "" && !child.type.endsWith("_redirect")) {
      args.push(wordText(child));
    }
  }

  return { type: "simple", name, args, assignments };
};
/* eslint-enable functional/no-let, functional/no-loop-statements, functional/immutable-data */

/* eslint-disable functional/no-let, functional/no-loop-statements, functional/immutable-data -- tree-sitter CST traversal needs imperative accumulation */
const parseDeclarationCommand = (node: Node): Parsed => {
  // tree-sitter-bash emits `export`, `declare`, `local`, `readonly`, `typeset`
  // as a `declaration_command` rather than a `command`. Structurally they are
  // still a builtin-name + args + assignments, so we surface them as Simple
  // so rules can match on `node.name`.
  const assignments: Assign[] = [];
  const args: string[] = [];
  // The builtin keyword is an anonymous child (e.g. an "export" token).
  let name = "";
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (!child) continue;
    if (!child.isNamed && name === "") {
      name = child.text;
      break;
    }
  }

  for (const child of node.namedChildren) {
    if (child.type === "variable_assignment") {
      assignments.push(parseAssignment(child));
      continue;
    }
    if (!child.type.endsWith("_redirect")) {
      args.push(wordText(child));
    }
  }

  return { type: "simple", name, args, assignments };
};
/* eslint-enable functional/no-let, functional/no-loop-statements, functional/immutable-data */

const parsePipeline = (node: Node): Parsed => {
  const stages = node.namedChildren
    .filter((c) => c.type !== "comment")
    .map(parseNode);
  return { type: "pipeline", stages };
};

/* eslint-disable functional/no-loop-statements -- tree-sitter CST traversal needs imperative iteration to inspect anonymous operator children */
const listOpFor = (node: Node): ";" | "&&" | "||" => {
  // The operator is an anonymous child of the list node.
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "&&" || child.type === "||" || child.type === ";") {
      return child.type;
    }
  }
  return ";";
};
/* eslint-enable functional/no-loop-statements */

const parseList = (node: Node): Parsed => {
  const op = listOpFor(node);
  const children = node.namedChildren
    .filter((c) => c.type !== "comment")
    .map(parseNode);
  return { type: "list", op, children };
};

const parseSubshell = (node: Node): Parsed => {
  // Subshell body is the first named child (skipping comments).
  const inner = node.namedChildren.find((c) => c.type !== "comment");
  return {
    type: "subshell",
    body: inner ? parseNode(inner) : { type: "unknown", raw: node.text },
  };
};

const parseFunction = (node: Node): Parsed => {
  const nameNode = node.childForFieldName("name");
  const bodyNode = node.childForFieldName("body");
  return {
    type: "function",
    name: nameNode ? nameNode.text : "",
    body: bodyNode ? parseNode(bodyNode) : { type: "unknown", raw: node.text },
  };
};

const parseNode = (node: Node): Parsed => {
  switch (node.type) {
    case "command":
      return parseCommand(node);
    case "declaration_command":
      return parseDeclarationCommand(node);
    case "pipeline":
      return parsePipeline(node);
    case "list":
      return parseList(node);
    case "subshell":
      return parseSubshell(node);
    case "function_definition":
      return parseFunction(node);
    case "compound_statement": {
      // `{ ... ; }` body. Treat multi-statement bodies as a `;`-separated list
      // so recursive descent in `walk` visits each statement.
      const children = node.namedChildren
        .filter((c) => c.type !== "comment")
        .map(parseNode);
      if (children.length === 0) return { type: "unknown", raw: node.text };
      if (children.length === 1) return children[0];
      return { type: "list", op: ";", children };
    }
    default:
      return { type: "unknown", raw: node.text };
  }
};

export const parse = (command: string): Parsed | null => {
  if (command.trim() === "") return null;
  const tree = parser.parse(command);
  if (tree.rootNode.hasError) return null;
  const meaningful = tree.rootNode.namedChildren.filter(
    (c) => c.type !== "comment",
  );
  if (meaningful.length === 0) return null;
  if (meaningful.length === 1) return parseNode(meaningful[0]);
  // tree-sitter-bash flattens `a; b; c` into sibling program children rather
  // than emitting a list node. Re-wrap them as a `;` list so downstream
  // traversal sees one root.
  return { type: "list", op: ";", children: meaningful.map(parseNode) };
};
