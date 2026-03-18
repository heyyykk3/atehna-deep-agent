import "dotenv/config";
import {
  createDeepAgent,
  LocalShellBackend,
  type SubAgent,
} from "deepagents";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// ── Custom Tools ──────────────────────────────────────────────

const dateTimeTool = tool(
  async () => new Date().toISOString(),
  {
    name: "get_datetime",
    description: "Returns the current date and time in ISO format",
    schema: z.object({}),
  }
);

// ── Subagents ─────────────────────────────────────────────────

const researcher: SubAgent = {
  name: "researcher",
  description:
    "Does deep research on any topic using available tools. Use when you need to find information, analyze data, or gather context.",
  systemPrompt: `You are an expert research agent. Your job:
1. Use filesystem tools to search codebases and read docs
2. Analyze and summarize findings with key facts
3. Flag any conflicting information
4. Provide clear, structured answers`,
  model: "google-genai:gemini-3.1-pro-preview",
};

const coder: SubAgent = {
  name: "coder",
  description:
    "Writes, debugs, and refactors code. Use for any coding task — new features, bug fixes, tests, or code reviews.",
  systemPrompt: `You are an expert software engineer. Your job:
1. Write clean, typed, well-documented code
2. Follow existing project conventions
3. Include error handling and edge cases
4. Write tests when appropriate
5. Explain your approach briefly`,
  model: "google-genai:gemini-3.1-pro-preview",
};

const tester: SubAgent = {
  name: "tester",
  description:
    "Runs tests, analyzes failures, and verifies code quality. Use after writing or modifying code.",
  systemPrompt: `You are a QA engineer. Your job:
1. Run the project's test suite
2. Analyze failures and suggest fixes
3. Check for edge cases and regressions
4. Report pass/fail summary`,
  model: "google-genai:gemini-3.1-pro-preview",
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
  model: "google-genai:gemini-3.1-pro-preview",

  systemPrompt: `You are Deep Agent — a production-grade AI assistant.

You can:
- Research topics using the researcher subagent
- Write and modify code using the coder subagent
- Run tests using the tester subagent
- Read, write, and edit files on the local filesystem
- Execute shell commands
- Plan complex tasks with todos

Guidelines:
- Break complex tasks into steps using write_todos
- Delegate specialized work to subagents via task tool
- Read files before editing them
- Verify changes by running tests when applicable
- Be concise but thorough`,

  tools: [dateTimeTool],
  subagents: [researcher, coder, tester],
  backend,

  interruptOn: {
    execute: true,
    write_file: {
      allowedDecisions: ["approve", "edit"] as const,
    },
  },
});

// ── Run ───────────────────────────────────────────────────────

async function main() {
  const userInput = process.argv.slice(2).join(" ") || "What can you do?";

  console.log(`\n> ${userInput}\n`);

  const result = await agent.invoke({
    messages: [{ role: "user", content: userInput }],
  });

  const lastMessage = result.messages[result.messages.length - 1];
  console.log("\n" + lastMessage.content + "\n");
}

main().catch(console.error);
