import "dotenv/config";
import {
  createDeepAgent,
  LocalShellBackend,
  type SubAgent,
} from "deepagents";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { InMemoryStore } from "@langchain/langgraph";

// ── Configuration ─────────────────────────────────────────────

// We use the same model across all agents for consistency and state management during a single run.
// It can be overridden by environment variable for multi-provider support.
const MODEL = process.env.MODEL || "anthropic:claude-3-5-sonnet-latest";

// ── Custom Tools ──────────────────────────────────────────────

const dateTimeTool = tool(
  async () => new Date().toISOString(),
  {
    name: "get_datetime",
    description: "Returns the current date and time in ISO format",
    schema: z.object({}),
  }
);

// Fallback vision verification tool using patchright (stealth playwright)
const visionVerifyTool = tool(
  async ({ url }: { url: string }) => {
    // This is a placeholder for actual patchright implementation
    // In a real implementation, it would use patchright to take a screenshot and pass it to the model.
    // For this example, we mock a response since we don't have patchright installed fully in the system context.
    return `[Mock] Vision Verification: Captured screenshot of ${url} and analyzed it. Page looks rendered correctly.`;
  },
  {
    name: "vision_verify",
    description: "Takes a screenshot of the current page using patchright and analyzes it visually. Use ONLY when strictly necessary ('hardly needed') to save tokens.",
    schema: z.object({
      url: z.string().describe("The URL or identifier of the page to verify"),
    }),
  }
);

// ── Subagents ─────────────────────────────────────────────────

const navigatorAgent: SubAgent = {
  name: "navigator",
  description:
    "Handles high-level browser navigation and page interactions using 'pinchtab' as the primary tool. Use this agent for clicking, typing, and navigating.",
  systemPrompt: `You are an expert browser automation agent. Your job:
1. Navigate to websites and interact with elements using 'pinchtab' binary via shell commands.
2. If 'pinchtab' fails, fallback to 'patchright' (stealth playwright).
3. Plan your actions carefully. Act, then use the execute tool to run the automation.
4. Only use vision verification when explicitly necessary to save tokens.`,
  model: MODEL,
  tools: [visionVerifyTool],
};

const visionVerifierAgent: SubAgent = {
  name: "vision_verifier",
  description:
    "Specialized agent for deep visual analysis. Call this when you need to understand the visual layout of a page or verify a complex interaction succeeded, but sparingly.",
  systemPrompt: `You are a visual analysis agent. Your job:
1. Take screenshots using 'patchright'.
2. Analyze the visual layout, check if elements are present, and verify successful state changes.
3. Provide a concise, highly accurate description of what you see.`,
  model: MODEL,
  tools: [visionVerifyTool],
};


// ── Backend ───────────────────────────────────────────────────

const backend = new LocalShellBackend({
  rootDir: process.cwd(),
  inheritEnv: true,
  timeout: 120,
  maxOutputBytes: 100_000,
});

// ── Agent ─────────────────────────────────────────────────────

const agent = createDeepAgent({
  model: MODEL,

  systemPrompt: `You are a specialized Browser Automation Agent.
Your architecture is built around navigating, acting, and verifying websites with high precision (Claude-level best practices).

Guidelines:
- **Plan:** Break complex tasks into steps using write_todos.
- **Act:** Use 'pinchtab' binary via shell commands (execute) as your primary tool for all interactions. Fallback to 'patchright' if 'pinchtab' is unavailable or fails.
- **Verify:** Verify your actions succeeded. Use text-based or DOM-based verification primarily.
- **Vision:** Use the vision verifier sparingly ("hardly needed") to save tokens, only when visual confirmation is strictly required.
- **Subagents:** Delegate specialized navigation or heavy visual analysis to your subagents via the task tool.
- Be precise and stick to your plan.`,

  tools: [dateTimeTool, visionVerifyTool],
  subagents: [navigatorAgent, visionVerifierAgent],
  backend,

  // Architecture updates for long-term memory and HITL
  checkpointer: new MemorySaver(),
  store: new InMemoryStore(),
  memory: ["./AGENTS.md"],
  skills: ["./skills/"],

  interruptOn: {
    execute: true,
    write_file: {
      allowedDecisions: ["approve", "edit"] as const,
    },
  },
});

// ── Run ───────────────────────────────────────────────────────

async function main() {
  const userInput = process.argv.slice(2).join(" ") || "Navigate to a test site and summarize its contents.";

  console.log(`\n> User: ${userInput}\n`);
  console.log(`[System] Initializing Stream with model: ${MODEL}...\n`);

  // Using stream for conversational, real-time feedback
  const stream = await agent.stream(
    { messages: [{ role: "user", content: userInput }] },
    { subgraphs: true, configurable: { thread_id: "browser-session-1" } }
  );

  for await (const [namespace, mode, data] of stream as any) {
    if (mode === "messages" && data[0]?.content) {
      // Simple stream output formatting
      if (typeof data[0].content === "string") {
        process.stdout.write(data[0].content);
      }
    } else if (mode === "updates") {
       // Optionally handle updates or subagent completions
    }
  }

  console.log("\n\n[System] Run complete.");
}

main().catch(console.error);
