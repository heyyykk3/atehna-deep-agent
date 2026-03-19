import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Think tool — lets the agent reason without executing actions.
 *
 * Borrowed from Stagehand's pattern: a non-action tool that gives the LLM
 * space to plan, analyze page state, or work through complex decisions
 * before committing to browser actions.
 *
 * This reduces hallucinated actions and improves multi-step task quality.
 */
export const thinkTool = tool(
  async ({ reasoning }) => {
    return `Reasoning acknowledged. Continue with your plan.`;
  },
  {
    name: "think",
    description:
      "Use this to reason through complex problems, plan multi-step sequences, " +
      "or analyze page state BEFORE acting. This does NOT execute any action. " +
      "Use it when: (1) deciding between multiple approaches, (2) analyzing a " +
      "complex page snapshot, (3) planning a multi-step form fill, (4) recovering " +
      "from a failed action. Always think before acting on unfamiliar pages.",
    schema: z.object({
      reasoning: z
        .string()
        .describe(
          "Your internal reasoning, analysis, or step-by-step plan. Be specific.",
        ),
    }),
  },
);
