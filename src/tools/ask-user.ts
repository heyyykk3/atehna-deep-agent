import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";

/**
 * Ask the user a question.
 *
 * In REPL mode: prompts via readline
 * In AgentAPI mode: emits an event, waits for response
 *
 * This tool uses the agent's interrupt mechanism — when the agent calls
 * this tool, the interruptOn config pauses execution and the interface
 * layer handles getting the user's response.
 *
 * For now, this is a simple tool that returns a placeholder.
 * The actual interrupt/resume flow is handled by the HITL middleware
 * and the REPL/AgentAPI interface in later phases.
 */
export const askUserTool = tool(
  async ({ question }) => {
    const answer = interrupt({
      kind: "question",
      question,
    });

    if (typeof answer === "string" && answer.trim()) {
      return answer.trim();
    }

    return `[ask_user] No user response received for: "${question}"`;
  },
  {
    name: "ask_user",
    description:
      "Ask the user a question and wait for their response. " +
      "Use when you need information only the user can provide " +
      "(personal details, preferences, clarification on ambiguous tasks). " +
      "Also use when stuck after multiple failed attempts on a step.",
    schema: z.object({
      question: z
        .string()
        .describe("The question to ask the user. Be specific and concise."),
    }),
  }
);
