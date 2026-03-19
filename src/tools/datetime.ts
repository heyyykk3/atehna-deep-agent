import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Returns the current date, time, and timezone.
 *
 * Useful for the agent to know "today", "tonight", "this week", etc.
 * when filling date fields in forms or scheduling tasks.
 */
export const dateTimeTool = tool(
  async () => {
    const now = new Date();
    return JSON.stringify({
      iso: now.toISOString(),
      date: now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      time: now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unixMs: now.getTime(),
    });
  },
  {
    name: "get_datetime",
    description:
      "Get the current date, time, and timezone. " +
      "Use when you need to know today's date for filling forms, " +
      "scheduling, or any time-sensitive task.",
    schema: z.object({}),
  }
);
