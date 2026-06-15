import type { Plugin } from "@opencode-ai/plugin";
import { evaluate, type Reviewer } from "../pipeline.ts";
import { harnessReviewer } from "../reviewers/config.ts";

type Options = Readonly<{ reviewer?: Reviewer }>;

export const createAgentCyaPlugin =
  ({ reviewer }: Options = {}): Plugin =>
  async () => {
    const effective = reviewer ?? harnessReviewer("opencode") ?? "opencode";
    return {
      "permission.ask": async (input, output) => {
        const pattern = input.pattern;
        const { decision } = await evaluate(
          {
            toolType: input.type,
            command: typeof pattern === "string" ? pattern : "",
            fileContent: null,
          },
          effective,
          0,
        );
        // eslint-disable-next-line functional/immutable-data -- OpenCode's permission.ask contract requires mutating output.status
        output.status = decision.decision;
      },
    };
  };

export const AgentCya = createAgentCyaPlugin();
export default AgentCya;
