import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Progress reporting tool — tracks task completion percentage.
 *
 * Borrowed from Browserable's pattern: the agent tracks completion %
 * which helps it know when to stop and gives the UI/user visibility
 * into long-running tasks.
 */
export const progressTool = tool(
  async ({ percentage, currentStep, remainingSteps, blockers }) => {
    const status =
      percentage >= 100
        ? "COMPLETE"
        : blockers && blockers.length > 0
          ? "BLOCKED"
          : "IN_PROGRESS";

    return JSON.stringify({ status, percentage, currentStep, remainingSteps, blockers });
  },
  {
    name: "reportProgress",
    description:
      "Report task progress after completing each major step. " +
      "Helps track how far along the task is and what remains. " +
      "Call this after each significant milestone (navigation, form section, verification).",
    schema: z.object({
      percentage: z
        .number()
        .min(0)
        .max(100)
        .describe("Estimated completion percentage (0-100)"),
      currentStep: z
        .string()
        .describe("What was just completed"),
      remainingSteps: z
        .array(z.string())
        .default([])
        .describe("What still needs to be done"),
      blockers: z
        .array(z.string())
        .default([])
        .describe("Any issues blocking progress"),
    }),
  },
);
