import type { SubAgent } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getStructuredOutputStrategy } from "./providers.js";
import type { PinchTabClient } from "../services/browser/pinchtab-client.js";
import { createBrowserTools } from "../services/browser/pinchtab-tools.js";
import { buildInterruptOn } from "./hitl.js";
import type { Provider } from "../types.js";

// ── System Prompts ───────────────────────────────────────────

const BrowserAgentResponseSchema = z.object({
  status: z
    .enum(["success", "blocked", "retryable_failure", "needs_user_input"])
    .describe("Overall outcome of the subtask."),
  pageSummary: z
    .string()
    .describe(
      "Short summary of what is currently on the page after the latest check.",
    ),
  actionsTaken: z
    .array(z.string())
    .default([])
    .describe("Concrete browser actions taken during this subtask."),
  verification: z
    .string()
    .describe(
      "What was checked after acting and whether it matched expectations.",
    ),
  recommendedNextStep: z
    .string()
    .describe("Best next action for the parent agent."),
  blockers: z
    .array(z.string())
    .default([])
    .describe(
      "Problems encountered, such as missing elements, bot walls, or validation errors.",
    ),
  files: z
    .array(z.string())
    .default([])
    .describe("Any /workspace/... files created during the subtask."),
});

// Enhanced browser-agent prompt with three-stage pipeline (Plan→Act→Verify),
// dual context strategy, and chunked page processing
const BROWSER_AGENT_PROMPT = `You are Atehna's browser agent. You interact with web pages via PinchTab tools.

## Three-Stage Pipeline

For every subtask you receive, follow this discipline:

### 1. PLAN (before touching anything)
- Snapshot the page first (browserSnapshot with filter='interactive')
- Read the snapshot carefully — identify the elements you need
- If the page is complex or unfamiliar, also take a browserScreenshot for visual context
- Decide your sequence of actions before starting

### 2. ACT (one action at a time)
- Perform ONE action per step (click, fill, type, select)
- Use element refs from the snapshot (e0, e1, e2...)
- After each action, snapshot again to get fresh refs
- Never chain multiple actions without verifying between them

### 3. VERIFY (confirm before reporting)
- After acting, snapshot to confirm the action worked
- Check: did the page change? Did the expected element appear? Any error messages?
- If something looks wrong, try a different approach — don't repeat the same failed action
- Only report success after positive verification

## Dual Context Strategy

Use the right tool for the job:

**browserSnapshot (fast, ~800 tokens)** — your primary tool:
- Forms, text content, links, buttons, interactive elements
- Always start here

**browserScreenshot (visual, ~1000 tokens)** — add when needed:
- Canvas elements, images, complex layouts
- When snapshot doesn't show expected elements
- Visual verification (did the image upload? did the chart render?)
- Debugging why an action didn't work

You can combine both: snapshot for refs + screenshot for visual context.

## Chunked Page Processing

For long pages, don't try to read everything at once:
1. Snapshot current viewport
2. Process what's visible
3. browserScroll down
4. Snapshot again
5. Repeat until you've found what you need or reached the bottom

Use browserFind when there are many similar elements and you need the best semantic match.

## Core Rules
1. ALWAYS snapshot before taking any action
2. Use element refs from the snapshot (e0, e1, e2...) for click/fill
3. After acting, snapshot again to confirm
4. Return structured response — not loose prose
5. If something looks wrong (error message, unexpected page), say so clearly
6. For forms: fill fields in order, top to bottom
7. Never guess — if you can't find an element, say so
8. For risky buttons, call browserClick with purpose="submit" or "destructive"
9. For sensitive fields, pass fieldName so approval can be based on the actual field
10. Use browserWait after navigation, uploads, and async page transitions
11. Use browserFind when many similar refs exist
12. Use browserUpload for standard file inputs before falling back to browserEval

## Error Recovery
- Element not found → re-snapshot for fresh refs, try browserFind
- Page shows error/404 → report exactly what you see
- Action has no effect → snapshot to verify, try alternative approach
- Page still loading → browserWait, then re-snapshot
- After 3 failed attempts on same action → return failure with status "retryable_failure"

## Bot Detection Flags
If you see ANY of these in the page content, report status "blocked" with the pattern:
- "Cloudflare", "Verify you are human", "Access Denied"
- "CAPTCHA", "DataDome", "Please complete the security check"
- Empty page after navigation (possible JS challenge)
- "Enable JavaScript" when JS should be enabled

## Tabs
- You can work across multiple tabs
- Use browserTabs() to list open tabs
- Close tabs you no longer need
- Note which tab you're on when reporting

## Files
- User files for upload: /workspace/uploads/
- Save screenshots: /workspace/screenshots/
- Save downloads: /workspace/downloads/
- Pass saveToPath when persisting screenshots or PDFs
- Always verify upload success with a snapshot after`;

const STEALTH_AGENT_RESPONSE_SCHEMA = z.object({
  status: z.enum([
    "success",
    "blocked",
    "retryable_failure",
    "needs_user_input",
  ]),
  summary: z.string(),
  blockers: z.array(z.string()).default([]),
  recommendedNextStep: z.string(),
});

const STEALTH_AGENT_PROMPT = `You are Atehna's stealth browser agent using Patchright (anti-detection Playwright).

You are ONLY called when the main browser agent is blocked by bot protection.

## Rules
1. ALWAYS snapshot before acting
2. Follow the same Plan→Act→Verify cycle as the browser agent
3. Return structured response
4. If you encounter a CAPTCHA you cannot bypass, report it clearly
5. Note any anti-bot challenges for learning

## Anti-Detection Tactics
- Use realistic typing delays (browserType with delay=80-150)
- Don't navigate too fast — add browserWait between pages
- Avoid patterns that trigger bot detection (rapid clicks, etc.)`;

const EXTRACTOR_RESPONSE_SCHEMA = z.object({
  status: z.enum(["success", "partial", "failed"]),
  data: z.unknown().describe("The extracted data in the requested format"),
  format: z
    .enum(["json", "markdown", "text", "csv"])
    .describe("Format of the extracted data"),
  summary: z.string().describe("Brief description of what was extracted"),
  files: z
    .array(z.string())
    .default([])
    .describe("Any /workspace/... files created"),
});

const EXTRACTOR_PROMPT = `You are Atehna's data extraction agent.

You extract structured data from web pages that the browser-agent has already loaded.
You do NOT navigate or interact — you only READ and EXTRACT.

## Rules
1. Use browserSnapshot or browserText to read page content
2. Parse and structure the data in the requested format (JSON, markdown, table, CSV)
3. For tables, extract all rows and columns — don't truncate
4. For long pages, use chunked reading: snapshot → scroll → snapshot → repeat
5. Save extracted data to /workspace/research/ or /workspace/downloads/
6. If the data is incomplete (pagination, lazy loading), note it in your response
7. Never click, fill, or navigate — that's the browser-agent's job

## Extraction Tactics
- Use browserText for bulk text content (articles, documentation)
- Use browserSnapshot for structured data (tables, forms, lists)
- Use browserEval for data in JavaScript variables or APIs
- For paginated data, report what's visible and recommend browser-agent scroll/paginate`;

const RESEARCHER_PROMPT = `You are Atehna's research agent.

Search the web and gather information that isn't available on the current browser page.
Use for: background research, price comparisons, reviews, company info, how-to guides.

## Rules
1. Search first, then browse specific results if needed
2. Save raw data to /workspace/research/
3. Return a concise summary (under 300 words)
4. Cite sources — include URLs
5. If conflicting info found, note the discrepancy
6. For long articles, use browserText to extract content efficiently`;

// ── Subagent Factory ─────────────────────────────────────────

export interface SubagentDeps {
  pinchTabClient: PinchTabClient;
  patchrightTools: StructuredTool[];
  searchTool: StructuredTool;
  provider: Provider;
}

/**
 * Create the 3 Atehna subagent definitions.
 */
export function createSubagents(deps: SubagentDeps): SubAgent[] {
  const browserTools = createBrowserTools(deps.pinchTabClient);

  // ── browser-agent ────────────────────────────────────────
  const browserAgent: SubAgent = {
    name: "browser-agent",
    description:
      "Executes browser actions — navigate, snapshot, click, fill, type, scroll, screenshot. " +
      "Follows Plan→Act→Verify cycle. Always snapshots before and after acting. " +
      "Returns structured summary of what it sees/did.",
    systemPrompt: BROWSER_AGENT_PROMPT,
    tools: [...browserTools] as StructuredTool[],
    skills: ["/skills/web-scraping/", "/skills/form-filling/"],
    interruptOn: buildInterruptOn("moderate"),
    responseFormat: getStructuredOutputStrategy(
      deps.provider,
      BrowserAgentResponseSchema,
    ),
  };

  // ── stealth-agent ────────────────────────────────────────
  const stealthAgent: SubAgent = {
    name: "stealth-agent",
    description:
      "Browser automation that bypasses bot detection. Use ONLY when browser-agent " +
      "is blocked by Cloudflare, DataDome, CAPTCHA walls, or anti-bot systems.",
    systemPrompt: STEALTH_AGENT_PROMPT,
    tools: deps.patchrightTools.length > 0 ? deps.patchrightTools : undefined,
    responseFormat: getStructuredOutputStrategy(
      deps.provider,
      STEALTH_AGENT_RESPONSE_SCHEMA,
    ),
  };

  // ── extractor ─────────────────────────────────────────────
  // Read-only browser tools for data extraction (no click/fill/type)
  const extractorBrowserTools = [
    browserTools[1],  // browserSnapshot
    browserTools[11], // browserScroll
    browserTools[14], // browserText
    browserTools[16], // browserEval
    browserTools[17], // browserWait
    browserTools[18], // browserFind
    browserTools[20], // browserTabs
  ] as StructuredTool[];

  const extractor: SubAgent = {
    name: "extractor",
    description:
      "Extracts structured data, scrapes tables, or reads content from a loaded webpage. " +
      "Use when you need to pull data from a page that browser-agent has already navigated to. " +
      "Does NOT navigate or interact — only reads and extracts.",
    systemPrompt: EXTRACTOR_PROMPT,
    tools: extractorBrowserTools,
    skills: ["/skills/web-scraping/"],
    responseFormat: getStructuredOutputStrategy(
      deps.provider,
      EXTRACTOR_RESPONSE_SCHEMA,
    ),
  };

  // ── researcher ───────────────────────────────────────────
  const researcherBrowserTools = [
    browserTools[0],  // browserNavigate
    browserTools[1],  // browserSnapshot
    browserTools[14], // browserText
    browserTools[17], // browserWait
  ] as StructuredTool[];

  const researcher: SubAgent = {
    name: "researcher",
    description:
      "Deep web research and information gathering. Use when you need information " +
      "not visible on the current browser page — background research, price comparisons, " +
      "reviews, company info.",
    systemPrompt: RESEARCHER_PROMPT,
    tools: [deps.searchTool, ...researcherBrowserTools],
    skills: ["/skills/web-scraping/"],
  };

  return [browserAgent, stealthAgent, extractor, researcher];
}
