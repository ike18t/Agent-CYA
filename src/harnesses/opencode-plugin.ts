import type { Plugin } from "@opencode-ai/plugin";
import { evaluate, type Reviewer } from "../pipeline.ts";

type Options = Readonly<{ reviewer?: Reviewer }>;

export const createAgentCyaPlugin =
  ({ reviewer = "claude" }: Options = {}): Plugin =>
  async () => ({
    "permission.ask": async (input, output) => {
      const pattern = input.pattern;
      const { decision } = await evaluate(
        {
          toolType: input.type,
          command: typeof pattern === "string" ? pattern : "",
          fileContent: null,
        },
        reviewer,
        0,
      );
      // eslint-disable-next-line functional/immutable-data -- OpenCode's permission.ask contract requires mutating output.status
      output.status = decision.decision;
    },
  });

export const AgentCya = createAgentCyaPlugin();
export default AgentCya;
