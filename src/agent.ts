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
import { chromium } from "patchright";

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
    console.log(`\n[System] Launching patchright for vision verification on: ${url}...`);
    let browser;
    try {
      // Launch patched chromium
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle" });

      // Capture screenshot as base64
      const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 80 });
      const base64Image = screenshotBuffer.toString("base64");

      return [
        {
          type: "text",
          text: `[Vision System] Successfully navigated to ${url} and captured a screenshot. Analyze this image visually to verify the layout or action success.`,
        },
        {
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${base64Image}` },
        },
      ];
    } catch (error: any) {
      return [
        {
          type: "text",
          text: `[Vision System Error] Failed to capture screenshot using patchright: ${error.message}`,
        },
      ];
    } finally {
      if (browser) await browser.close();
    }
  },
  {
    name: "vision_verify",
    description: "Takes a screenshot of the current page using patchright and returns the base64 image data for you to analyze visually. Use ONLY when strictly necessary ('hardly needed') to save tokens.",
    schema: z.object({
      url: z.string().describe("The URL to navigate to and verify"),
    }),
  }
);

// ── Subagents ─────────────────────────────────────────────────

const actorAgent: SubAgent = {
  name: "actor",
  description:
    "Executes browser navigation and page interactions (clicks, typing, scrolling). Call this agent when you need to physically interact with a webpage.",
  systemPrompt: `You are an expert browser automation Actor. Your job:
1. Perform the exact physical interactions requested by the orchestrator.
2. ALWAYS use the 'pinchtab' binary via shell commands (execute tool) as your primary interaction method.
3. Make sure to account for Windows vs Mac shell differences when formulating commands.
4. Report back strictly on whether the command executed successfully or if an error occurred in the shell. Do NOT verify the visual state of the page.`,
  model: MODEL,
};

const verifierAgent: SubAgent = {
  name: "verifier",
  description:
    "Verifies whether an action performed by the Actor was successful on the webpage. Call this agent to check the current state of the page (e.g. did the page load, is the modal open, did the login succeed).",
  systemPrompt: `You are an expert browser automation Verifier. Your job:
1. Verify the current state of the webpage against the expected outcome.
2. Attempt lightweight DOM or text-based verification first (via shell commands if available).
3. If structural verification is insufficient, use the 'vision_verify' tool (which uses 'patchright') for hard visual confirmation. Use vision sparingly ("hardly needed") to save tokens.
4. Return a clear true/false and a brief explanation of the page's state.`,
  model: MODEL,
  tools: [visionVerifyTool],
};

const extractorAgent: SubAgent = {
  name: "extractor",
  description:
    "Extracts structured data, scrapes tables, or reads long content from a successfully loaded webpage. Call this agent when you need to pull information off a page.",
  systemPrompt: `You are an expert browser automation Extractor. Your job:
1. Read and extract the specific data requested by the orchestrator from the current webpage.
2. Use DOM querying shell tools (like curl, grep, or pinchtab extraction features) to isolate the data.
3. Format the extracted data cleanly (JSON, Markdown, or raw text as requested) and return it.
4. Do not perform navigation or state-changing actions. Focus purely on reading the data.`,
  model: MODEL,
};


// ── Backend ───────────────────────────────────────────────────

const backend = new LocalShellBackend({
  rootDir: process.cwd(),
  inheritEnv: true,
  timeout: 120,
  maxOutputBytes: 100_000,
});

// ── Main Orchestrator Agent ───────────────────────────────────

const agent = createDeepAgent({
  model: MODEL,

  systemPrompt: `You are the Main Orchestrator for a specialized Browser Automation framework.
Your architecture is built around the "Plan -> Act -> Verify -> Extract" loop with high precision (Claude-level best practices).

Guidelines:
- **Plan:** ALWAYS break complex tasks into steps using the built-in 'write_todos' tool. Update your plan as you progress.
- **Orchestrate:** You are the manager. Do not execute browser actions yourself. Delegate tasks to your specialized subagents:
  1. Call 'actor' to navigate, click, or type.
  2. Call 'verifier' to check if the actor's action succeeded (especially for complex multi-step forms).
  3. Call 'extractor' to scrape or read data from the page once it is in the correct state.
- **Vision:** Visual verification is expensive. Instruct the verifier to use vision ONLY when strict confirmation is required ("hardly needed").
- Be precise, monitor the progress of your plan, and summarize the final result for the user.`,

  tools: [dateTimeTool],
  subagents: [actorAgent, verifierAgent, extractorAgent],
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
