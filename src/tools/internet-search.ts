import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Internet search tool using Tavily.
 *
 * Requires TAVILY_API_KEY in environment.
 * Falls back to a stub if @langchain/tavily is not installed.
 */
export async function createInternetSearchTool() {
  try {
    const { TavilySearch } = await import("@langchain/tavily");
    return new TavilySearch({
      maxResults: 5,
    });
  } catch {
    // Fallback: stub tool that tells the agent search isn't available
    return tool(
      async ({ query }) => {
        return `Internet search is not available. Install @langchain/tavily and set TAVILY_API_KEY to enable it. Query was: "${query}"`;
      },
      {
        name: "internetSearch",
        description:
          "Search the internet for information. Returns relevant web results. " +
          "Use when you need information not available on the current browser page.",
        schema: z.object({
          query: z.string().describe("Search query"),
        }),
      }
    );
  }
}
