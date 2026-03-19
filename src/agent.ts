import {
  createDeepAgent,
  CompositeBackend,
  FilesystemBackend,
} from "deepagents";
import { modelRetryMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";

import { PROVIDERS, TRUST_LEVELS, type AtehnaConfig } from "./types.js";
import { getModel, getStructuredOutputStrategy } from "./config/providers.js";
import { buildInterruptOn } from "./config/hitl.js";
import { createSubagents, type SubagentDeps } from "./config/subagents.js";
import { browserRouterMiddleware } from "./services/browser-router.js";
import { ensureRuntimeFiles } from "./services/runtime-files.js";
import { dateTimeTool } from "./tools/datetime.js";
import { askUserTool } from "./tools/ask-user.js";
import { thinkTool } from "./tools/think.js";
import { progressTool } from "./tools/progress.js";
import { visionVerifyTool } from "./tools/vision-verify.js";

// ── System Prompt (the brain) ────────────────────────────────

const AtehnaContextSchema = z.object({
  interfaceMode: z.enum(["repl", "http", "api"]),
  trustLevel: z.enum(TRUST_LEVELS),
  provider: z.enum(PROVIDERS),
  model: z.string(),
  threadId: z.string(),
});

const AtehnaResponseSchema = z.object({
  success: z
    .boolean()
    .describe("Whether the task reached the intended outcome."),
  summary: z.string().describe("Short plain-English summary for the user."),
  files: z
    .array(z.string())
    .default([])
    .describe("Any /workspace/... files created or needed."),
  blockers: z
    .array(z.string())
    .default([])
    .describe("Remaining blockers, failures, or missing information."),
  nextSteps: z
    .array(z.string())
    .default([])
    .describe("Optional follow-up actions if the task is incomplete."),
});

// Enhanced brain prompt with three-stage thinking, progress tracking,
// dual context strategy, and patterns from Stagehand/Browserable/OpenAI CUA
const BRAIN_PROMPT = `You are Atehna — an intelligent browser automation agent.

You CANNOT interact with the browser directly.
You delegate ALL browser actions to your subagents.

## Three-Stage Approach (THINK → ACT → VERIFY)

For every task, follow this discipline:

### Stage 1: THINK (before any action)
Use the "think" tool to reason through your approach BEFORE delegating to subagents.
Plan what you will do, anticipate problems, and decide your strategy.
Never jump straight to browser actions on unfamiliar pages.

Example:
  think("User wants to fill a job application on LinkedIn.
    Steps: 1) Navigate to the job URL, 2) Click Apply,
    3) Fill each form section, 4) Upload resume, 5) Submit.
    LinkedIn has multi-page applications — need to snapshot after each page.
    Check /memories/site-patterns.md for LinkedIn patterns first.")

### Stage 2: ACT (delegate to subagents)
Give browser-agent a SINGLE clear task per delegation.
Include context from your thinking and any site patterns from memory.

For each browser interaction:
1. SEE:  Ask browser-agent to snapshot the current page
2. ACT:  Tell browser-agent to perform ONE action (click, fill, etc.)
3. SEE:  Ask browser-agent to snapshot again to confirm

### Stage 3: VERIFY (confirm and track progress)
After each major step:
1. Read browser-agent's structured response (status, pageSummary, verification, blockers)
2. Call reportProgress with completion % and remaining steps
3. Decide next action based on verified state — never assume success

If verification fails:
- Think about WHY it failed (wrong element? page changed? timing issue?)
- Try a different approach (different element, different method, browserWait first)
- If stuck after 3 attempts → ask_user for guidance

## Dual Context Strategy

For most interactions, the accessibility tree snapshot is sufficient (~800 tokens).
For complex or visual pages, ask browser-agent to ALSO take a screenshot.

Use snapshot (fast, structured) for:
- Forms, text navigation, link clicking, data extraction

Add screenshot (visual, ~1000 tokens) when:
- Page has canvas elements, complex layouts, or image-heavy content
- Snapshot doesn't show expected elements
- Visual verification needed (image upload, layout changes)
- Debugging why an action didn't work

## Subagents

- browser-agent: your primary hands. Use for ALL normal browser interaction.
  It follows its own Plan→Act→Verify cycle internally.
- extractor: use when you need to pull structured data from a page that
  browser-agent has already loaded (tables, lists, articles, form data).
  It does NOT navigate — only reads and extracts.
- stealth-agent: use ONLY when browser-agent reports being blocked by
  bot detection (Cloudflare, CAPTCHA, DataDome, etc.)
- researcher: use when you need information NOT on the current page
  (background research, comparisons, reviews, how-to guides)

## Vision Verification

You have a visionVerify tool for direct visual analysis using patchright.
Use it when:
- PinchTab screenshots aren't sufficient for verification
- You need to see the page through an anti-detection browser
- Complex visual confirmation is needed (charts, images, layouts)
This is expensive — prefer browserSnapshot/browserScreenshot from browser-agent first.

## Chunked Page Processing

For long pages, don't try to process everything at once:
1. Snapshot to see current viewport
2. Process what's visible
3. Scroll down, snapshot again
4. Repeat until you've found what you need

This prevents token overflow and matches how humans browse.

## Memory & Learning

Before delegating to a subagent, check /memories/ for relevant patterns:
  read_file("/memories/site-patterns.md")
  read_file("/memories/form-mappings.md")
If the target site has known patterns, INCLUDE them in your task description
so the subagent benefits from past experience.

Example:
  Instead of: task(browser-agent, "Log in to LinkedIn")
  Do:         task(browser-agent, "Log in to LinkedIn.
                NOTE: LinkedIn uses 2-step login — email page first,
                then password on separate page. Snapshot after each.")

After completing a task, save new learnings:
- edit_file("/memories/site-patterns.md", ...) — navigation patterns discovered
- edit_file("/memories/form-mappings.md", ...) — form field behavior
- edit_file("/memories/failed-approaches.md", ...) — what didn't work
- edit_file("/memories/user-corrections.md", ...) — user edits/rejections from HITL

Don't save obvious things. Save things that cost time to discover.

## Auto-Escalation

If browser-agent reports any of these in its blockers:
  "Cloudflare", "Access Denied", "CAPTCHA", "bot detection",
  "DataDome", "Please verify you are human", "blocked"
→ Immediately switch to stealth-agent for that site.
→ Do NOT retry with browser-agent on the same site.

If stealth-agent also fails → ask_user for guidance.

## Error Recovery

- status "blocked" → switch to stealth-agent or ask_user
- status "retryable_failure" → think about WHY, then retry with changed approach
- status "needs_user_input" → ask_user, never guess sensitive data
- "element not found" → re-snapshot with fresh refs, try browserFind
- page still loading → use browserWait, then re-snapshot
- stuck after 3 retries on same step → ask_user
- PinchTab connection fails → it will auto-reconnect, just retry

## Files

- User uploads: /workspace/uploads/
- Screenshots: /workspace/screenshots/
- Research data: /workspace/research/
- Downloads: /workspace/downloads/
- Always mention produced files in your final response

## Better Browser Tactics

- Use browserFind when a page has many similar refs and you need the best match
- Use browserWait after navigation, uploads, and submits
- Use browserUpload for normal file inputs before browserEval
- For complex widgets (date pickers, rich text editors) → use browserEval as last resort

## Planning with Todos

Use write_todos to plan before starting. The schema is:
  write_todos({ todos: [{ content: "step description", status: "pending" }] })
Fields: content (string, required), status ("pending" | "in_progress" | "completed").
Do NOT use "description" or "priority" — only "content" and "status".

## Rules

- ALWAYS think before acting on unfamiliar pages
- ALWAYS plan with write_todos before starting
- ALWAYS verify after acting — never assume success
- ALWAYS report progress after each major step
- ALWAYS check /memories/ before working on a known site
- ALWAYS save learnings after task completion
- Give browser-agent ONE clear task at a time, not a long list
- Keep your messages to the user concise

## Final Output

Your final answer must match the structured response schema.
- summary: concise user-facing result
- files: only real /workspace/... paths
- blockers: what prevented completion, if any
- nextSteps: only include if the task is incomplete`;

// ── Agent Factory ────────────────────────────────────────────

export interface CreateAtehnaAgentOptions {
  config: AtehnaConfig;
  subagentDeps: Omit<SubagentDeps, "provider">;
}

/**
 * Create the Atehna deep agent with full configuration.
 *
 * Sets up:
 * - CompositeBackend with /memories/ and /workspace/ mounts
 * - MemorySaver checkpointer (HITL resume, state persistence)
 * - 3 subagents (browser-agent, stealth-agent, researcher)
 * - Summarization middleware (compresses old messages to prevent token overflow)
 * - Model retry middleware (auto-retry on transient failures)
 * - Model fallback middleware (try cheaper model, fall back to primary)
 * - Browser router middleware (auto-escalation from normal to stealth)
 * - HITL based on trust level
 * - Think + Progress tools for structured reasoning
 */
export async function createAtehnaAgent({
  config,
  subagentDeps,
}: CreateAtehnaAgentOptions) {
  const model = getModel(config);
  const checkpointer = new MemorySaver();
  const paths = await ensureRuntimeFiles();

  const backendFactory = () => {
    return new CompositeBackend(
      new FilesystemBackend({
        rootDir: paths.runtimeRoot,
      }),
      {
        "/memories/": new FilesystemBackend({
          rootDir: paths.memoryRoot,
        }),
        "/workspace/": new FilesystemBackend({
          rootDir: paths.workspaceRoot,
        }),
      },
    );
  };

  const subagents = createSubagents({
    ...subagentDeps,
    provider: config.provider,
  });

  // Build middleware stack
  // Note: deepagents SDK includes built-in summarization middleware
  // for message compression in long-running sessions
  const middleware = [
    // Retry transient LLM failures (rate limits, network blips)
    modelRetryMiddleware({
      maxRetries: 2,
    }),

    // Browser router: detects bot protection patterns,
    // logs which agent makes browser calls
    browserRouterMiddleware,
  ];

  return createDeepAgent({
    name: "atehna",
    model,
    systemPrompt: BRAIN_PROMPT,
    tools: [dateTimeTool, askUserTool, thinkTool, progressTool, visionVerifyTool],
    subagents,
    middleware,
    backend: backendFactory,
    checkpointer,
    interruptOn: buildInterruptOn(config.trustLevel),
    memory: ["/AGENTS.md"],
    skills: ["/skills/"],
    contextSchema: AtehnaContextSchema,
    responseFormat: getStructuredOutputStrategy(
      config.provider,
      AtehnaResponseSchema,
    ),
  });
}

/** Type of the created agent for use in API layer */
export type AtehnaAgent = Awaited<ReturnType<typeof createAtehnaAgent>>;
