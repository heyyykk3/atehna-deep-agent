# Atehna Deep Agent — Implementation Plan

**Date**: 2026-03-18
**SDK**: `deepagents@1.8.4`
**Product**: Consumer browser automation app
**Model**: Single provider chosen by user — one model for everything
**Core Pattern**: SEE → PLAN → ACT → VERIFY

---

## Design Principles

1. **Browser automation is the product** — everything serves this
2. **SEE → PLAN → ACT → VERIFY loop** — main agent is the brain, subagents are the hands
3. **Single model** — user picks one provider, all agents use it
4. **Consumer-first** — minimal config, just works
5. **REPL for testing** → **AgentAPI for Electron** (coming soon)
6. **Use what the SDK gives us** — custom code only where SDK doesn't provide
7. **Agent learns** — saves site patterns, form mappings, failed approaches to /memories/ via StoreBackend
8. **Memory flows into tasks** — when main agent delegates, it includes relevant memories in the task description

---

## Core Loop: SEE → PLAN → ACT → VERIFY

```
User: "Book a table at Olive Garden for 2 at 7pm"
                    │
                    ▼
┌──────────────────────────────────────────────────────────┐
│  MAIN AGENT (atehna) — the brain                         │
│  Never touches browser directly. Thinks, plans, verifies.│
│                                                          │
│  PLAN: write_todos                                       │
│    ☐ Go to olivegarden.com                               │
│    ☐ Find reservation page                               │
│    ☐ Fill form: 2 guests, tonight, 7pm                   │
│    ☐ Fill personal info (HITL)                           │
│    ☐ Submit and save confirmation                        │
│                                                          │
│  ┌─── Loop for each step ───────────────────────────┐    │
│  │                                                   │    │
│  │  SEE:    task(browser-agent, "snapshot the page") │    │
│  │          ← returns: accessibility tree summary    │    │
│  │                                                   │    │
│  │  PLAN:   analyze what's on page                   │    │
│  │          decide next action                       │    │
│  │                                                   │    │
│  │  ACT:    task(browser-agent, "click Reserve       │    │
│  │          a Table button [e2]")                     │    │
│  │          ← returns: "clicked, page loading"       │    │
│  │                                                   │    │
│  │  VERIFY: task(browser-agent, "snapshot again,     │    │
│  │          confirm reservation form is showing")    │    │
│  │          ← returns: "form visible with fields..." │    │
│  │                                                   │    │
│  │  If verify fails → replan (try different approach)│    │
│  │  If verify passes → next step                     │    │
│  └───────────────────────────────────────────────────┘    │
│                                                          │
│  Result → user                                           │
└──────────────────────────────────────────────────────────┘
```

### Why this pattern works

| Layer | Role | Why separate |
|---|---|---|
| **Main agent** | Brain — plans, decides, verifies | Keeps context clean. Sees summaries, not raw browser state |
| **browser-agent** | Hands — snapshots, clicks, fills | Isolates browser noise (~800 tokens/snapshot). Returns concise results |
| **stealth-agent** | Sneaky hands — same but anti-detection | For bot-protected sites. Main agent switches to this when needed |
| **researcher** | Eyes beyond browser — web search | When task needs info not on the current page |

### What each agent sees

```
Main agent context:
  "I asked browser-agent to snapshot olivegarden.com.
   It returned: page has nav links, Reserve a Table button [e2].
   → I should tell it to click [e2]."

Browser-agent context (isolated, discarded after):
  [full accessibility tree — 50+ elements, 800 tokens]
  [full snapshot metadata]
  [tool call history for this subtask]

Main agent never sees the raw accessibility tree.
Only the summary that browser-agent returns.
```

---

## Vision Fallback

The accessibility tree (~800 tokens) is the fast path. But it's not always enough:
- Canvas elements (no accessibility info)
- Complex UIs (video editors, drag-and-drop)
- Image-heavy pages (product galleries, maps)
- Non-standard widgets (custom date pickers, sliders)

The SEE step has two modes:

```
SEE (fast):  browserSnapshot() → accessibility tree
             Good for: forms, navigation, text-heavy pages
             Cost: ~800 tokens

SEE (deep):  browserScreenshot() → image sent to vision model
             Good for: canvas, media editors, visual verification
             Cost: ~1000 tokens (image) + vision model processing
```

**browser-agent decides which to use.** Its system prompt says:
- Start with snapshot (fast, cheap)
- If snapshot doesn't show what you expect, or the task involves visual elements → take a screenshot
- For verification of visual changes (image uploaded, video trimmed) → always screenshot
- For form filling and navigation → snapshot is enough

Both can be combined: snapshot for element refs + screenshot for visual context.

---

## Error Recovery

### PinchTab Connection Errors
```
PinchTab crashes → lifecycle.ts detects via health check
  → auto-restart PinchTab process
  → checkpointer has full agent state
  → resume from last checkpoint (same thread ID)
  → browser-agent re-snapshots to see current page state
```

### Page Errors
```
Page 404 / timeout / error:
  browser-agent reports: "Page returned 404" or "Navigation timed out"
  → main agent receives this in VERIFY step
  → replans: try different URL, search for correct page, ask user

Element not found (stale ref after page update):
  browser-agent reports: "Element [e5] not found"
  → browser-agent automatically re-snapshots to get fresh refs
  → retries with new ref
  → if fails 3x → returns failure to main agent → replan
```

### Provider Errors
```
Rate limited (429):
  → model.withRetry() handles automatically (3 retries, exponential backoff)
  → transparent to the agent

Provider down:
  → retries exhausted → error surfaces to user
  → "Provider unavailable. Try again or switch provider."
```

### Recovery Rules (in system prompts)
- **browser-agent**: "If element not found, re-snapshot and retry with fresh refs. If page shows error, report exactly what you see."
- **main agent**: "If browser-agent reports failure, try a different approach. If stuck after 3 attempts on the same step, ask the user via ask_user."

---

## Learning Loop (Memory)

The agent learns from every task and gets smarter over time via `/memories/` (StoreBackend → persists across threads).

### What Gets Saved

```
/memories/
├── site-patterns.md        # Navigation patterns per site
│   "linkedin.com: login is 2-step (email page → password page)"
│   "zillow.com: search box is in hero section, ref usually e3-e5"
│   "olivegarden.com: reservations at /reserve not linked from nav"
│
├── form-mappings.md         # Field-to-value mappings
│   "linkedin job apply: 'Phone country code' is a dropdown, select before filling"
│   "zillow contact form: phone field validates format XXX-XXX-XXXX"
│
├── failed-approaches.md     # What didn't work (so agent doesn't repeat)
│   "indeed.com: clicking 'Apply' opens popup, not new page — use snapshot after click"
│   "capcut.com: timeline drag doesn't work via click, need eval() for drag events"
│
└── user-corrections.md      # Things user edited/rejected via HITL
    "User prefers 'Kunj Patel' not 'kunj patel' for name fields"
    "User rejected auto-fill of phone number — always ask"
```

### How Memory Flows Into Tasks

When the main agent delegates to a subagent via `task()`, it includes relevant memories in the task description. This is key — **subagents are ephemeral** (context isolated, discarded after), so they don't read /memories/ themselves. The main agent IS the memory carrier.

```
Main agent knows (from /memories/):
  "linkedin.com login is 2-step"

Main agent delegates:
  task(browser-agent, "Navigate to linkedin.com and log in.
    NOTE: LinkedIn uses 2-step login — first email, then password
    on a separate page. Snapshot after each step.")

Browser-agent uses this context to navigate correctly
without discovering the pattern from scratch.
```

### When to Save

The main agent saves memories at these points:
1. **After successful task completion** — save patterns that worked
2. **After failed approach → successful retry** — save what failed and what worked
3. **After HITL edit/reject** — save user preferences
4. **After discovering site-specific behavior** — save for next time

### System Prompt Addition (main agent)

```
## Memory & Learning

Before delegating to a subagent, check /memories/ for relevant patterns:
  read_file("/memories/site-patterns.md")
If the target site has known patterns, include them in your task description.

After completing a task, save new learnings:
  edit_file("/memories/site-patterns.md", ...) — navigation patterns
  edit_file("/memories/form-mappings.md", ...) — form field behavior
  edit_file("/memories/failed-approaches.md", ...) — what didn't work
  edit_file("/memories/user-corrections.md", ...) — user preferences from HITL

Don't save obvious things. Save things that cost time to discover.
```

---

## Multi-Tab Support

Some tasks need multiple tabs — price comparison, copy data between sites, reference one page while filling another.

PinchTab supports tabs via:
- `browserTabs()` — list all open tabs with IDs
- `browserNavigate(url)` — opens in current tab (or new tab if specified)
- `browserClose(tabId)` — close a specific tab

### How It Works

```
Main agent: "Compare prices for AirPods on Amazon vs Best Buy"

  task(browser-agent, "Open amazon.com, search AirPods, get price.
    Then open bestbuy.com in a new tab, search AirPods, get price.
    Return both prices.")

Browser-agent:
  1. browserNavigate("https://amazon.com")  → Tab 1
  2. [search, get price: $179]
  3. browserNavigate("https://bestbuy.com") → Tab 2 (new tab)
  4. [search, get price: $169]
  5. browserTabs() → [Tab 1: amazon, Tab 2: bestbuy]
  6. Returns: "Amazon: $179, Best Buy: $169"
```

### Browser-Agent Prompt Addition

```
## Tabs
- You can work across multiple tabs
- Use browserTabs() to see all open tabs
- When comparing across sites, open each in its own tab
- Close tabs you no longer need to keep browser clean
- Always note which tab you're on when reporting results
```

---

## File Handling Through Browser

### Upload Flow (user file → browser)
```
1. User provides file (resume, image, document)
   → saved to /workspace/uploads/resume.pdf

2. Main agent delegates:
   task(browser-agent, "Upload resume from /workspace/uploads/resume.pdf
     to the file input on the job application form")

3. Browser-agent:
   a. browserSnapshot() → finds file input [e12]
   b. read_file("/workspace/uploads/resume.pdf") → confirms file exists
   c. browserEval("document.querySelector('input[type=file]')...") → triggers upload
      ⚠ HITL: approve eval
   d. browserSnapshot() → verify "resume.pdf" shown as uploaded
```

### Download Flow (browser → user)
```
1. Browser produces files during task:
   - Screenshots: /workspace/screenshots/confirmation.png
   - PDFs: /workspace/downloads/receipt.pdf
   - Data: /workspace/research/results.json

2. Browser-agent saves via:
   - browserScreenshot() → auto-saved to /workspace/screenshots/
   - browserPdf() → saved to /workspace/downloads/
   - write_file() → structured data to /workspace/research/

3. Main agent reports files in result:
   "Done! Files saved:
    - /workspace/screenshots/confirmation.png
    - /workspace/downloads/receipt.pdf"

4. AgentAPI exposes files for Electron to display/download
```

### Browser-Agent Prompt Addition

```
## Files
- User files for upload are in /workspace/uploads/
- Save screenshots to /workspace/screenshots/
- Save downloaded files to /workspace/downloads/
- Save research data to /workspace/research/
- For file upload inputs: use browserEval() to set the file (requires HITL approval)
- Always verify upload success with a snapshot after
```

---

## Architecture

```
Layer 3: Interfaces
├── REPL (testing + refinement)
└── AgentAPI class (→ Electron soon)

Layer 2: Deep Agent
├── Main Agent ("atehna" — brain)
│   ├── Plans with write_todos
│   ├── Reads /memories/ before delegating (RECALL)
│   ├── Passes memory context into task descriptions
│   ├── Delegates SEE/ACT to subagents
│   ├── Verifies results (VERIFY)
│   ├── Replans on failure
│   ├── Saves learnings to /memories/ after tasks (LEARN)
│   └── Tools: datetime, ask_user, filesystem (read/write memories)
│
├── Subagents (3 — the hands)
│   ├── browser-agent — PinchTab tools (15)
│   │   Skills: web-scraping, form-filling
│   │   HITL: sensitive fields, eval, submit
│   │   SEE: snapshot (fast) or screenshot (vision fallback)
│   │   Handles: multi-tab, file upload/download, error recovery
│   │
│   ├── stealth-agent — Patchright MCP tools
│   │   For: Cloudflare, DataDome, bot-protected sites
│   │
│   └── researcher — search + browser read tools
│       Skills: web-scraping
│       For: gathering info beyond current page
│
├── SDK Middleware (9 = 6 auto + 3 opt-in)
├── Custom Middleware (1 = browser router)
│
├── CompositeBackend
│   ├── /           → StateBackend (ephemeral scratch)
│   ├── /memories/  → StoreBackend (cross-thread persistent learning)
│   │   ├── site-patterns.md
│   │   ├── form-mappings.md
│   │   ├── failed-approaches.md
│   │   └── user-corrections.md
│   └── /workspace/ → FilesystemBackend (local disk)
│       ├── uploads/      (user → agent)
│       ├── downloads/    (agent → user)
│       ├── screenshots/  (browser captures)
│       └── research/     (researcher output)
│
├── MemorySaver (checkpointer — state + HITL + resume)
├── InMemoryStore (cross-thread memory backing StoreBackend)
├── Skills (5 directories)
├── Memory (AGENTS.md — static identity)
└── HITL (tiered interruptOn)

Layer 1: Core Services
├── BrowserService (PinchTab client + tools + lifecycle + reconnect)
├── ProviderService (single provider + retry)
├── ConfigService (.env, trust levels)
└── PatchrightMCP (stealth via MCP)
```

### Data Flow

```
                    ┌─────────────┐
                    │   /memories/ │ (StoreBackend — persists across threads)
                    └──────┬──────┘
                     read ↑│↓ write
                    ┌──────┴──────┐
User ──→ REPL/API ──→ Main Agent ──→ task(browser-agent, "do X. CONTEXT: ...")
                    │  (brain)    │              │
                    │  RECALL     │              ▼
                    │  PLAN       │      Browser-Agent ──→ PinchTab ──→ Browser
                    │  DELEGATE   │              │
                    │  VERIFY     │              ▼
                    │  LEARN      │      Returns: concise summary
                    └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  /workspace/ │ (FilesystemBackend — files)
                    └─────────────┘
```

---

## Subagents (3)

### browser-agent (the hands)
```typescript
{
  name: "browser-agent",
  description: "Executes browser actions — navigate, snapshot, click, fill, type, scroll, screenshot. Always snapshot before and after acting. Return concise summary of what you see/did.",
  systemPrompt: `You are Atehna's browser agent. You interact with web pages via PinchTab tools.

## Core Rules
1. ALWAYS snapshot the page before taking any action
2. Use element refs from the snapshot (e0, e1, e2...) to click/fill
3. After acting, snapshot again to confirm the action worked
4. Return a CONCISE summary — what you see, what you did, what changed
5. If something looks wrong (error message, unexpected page), say so clearly
6. For forms: fill fields in order, top to bottom
7. Never guess — if you can't find an element, say so

## Vision
- Start with browserSnapshot() (fast, ~800 tokens)
- If snapshot doesn't show expected elements → take browserScreenshot() for visual analysis
- For visual verification (image uploaded, layout changed) → always screenshot
- For forms and text navigation → snapshot is enough
- You can combine both: snapshot for refs + screenshot for visual context

## Error Recovery
- If element not found: re-snapshot to get fresh refs, retry with new ref
- If page shows error/404: report exactly what you see to main agent
- If action seems to have no effect: snapshot to verify, try alternative approach
- After 3 failed attempts on same action → return failure, let main agent replan

## Tabs
- You can work across multiple tabs
- Use browserTabs() to list open tabs
- When comparing across sites, open each in its own tab
- Close tabs you no longer need
- Note which tab you're on when reporting

## Files
- User files for upload are in /workspace/uploads/
- Save screenshots to /workspace/screenshots/
- Save downloads to /workspace/downloads/
- For file upload inputs: use browserEval() to set the file (requires HITL)
- Always verify upload success with a snapshot after`,
  tools: [/* all 15 PinchTab tools */],
  skills: ["/skills/web-scraping/", "/skills/form-filling/"],
  interruptOn: {
    browserFill: { allowedDecisions: ["approve", "edit", "reject"] },
    browserEval: { allowedDecisions: ["approve", "reject"] },
  },
}
```

### stealth-agent (the sneaky hands)
```typescript
{
  name: "stealth-agent",
  description: "Browser automation that bypasses bot detection. Use ONLY when browser-agent is blocked by Cloudflare, DataDome, CAPTCHA walls, or anti-bot systems.",
  systemPrompt: `You are Atehna's stealth browser agent using Patchright (anti-detection Playwright).
Same rules as browser-agent but you bypass bot protection.
Only called when the main browser is blocked.`,
  tools: [/* patchright MCP tools */],
}
```

### researcher (the eyes beyond)
```typescript
{
  name: "researcher",
  description: "Deep web research and information gathering. Use when you need information not visible on the current browser page — background research, price comparisons, reviews, company info.",
  systemPrompt: `You are Atehna's research agent.
Search the web, gather information, synthesize findings.
Save raw data to /workspace/research/.
Return a concise summary (under 300 words).`,
  tools: [internetSearch, browserNavigate, browserSnapshot, browserText],
  skills: ["/skills/web-scraping/"],
}
```

---

## Provider Model (Single)

User picks ONE provider. Everything uses it.

```env
# User config — pick one
ATEHNA_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Optional override
ATEHNA_MODEL=anthropic:claude-sonnet-4-6
ATEHNA_TRUST_LEVEL=moderate
PINCHTAB_PORT=9867
```

| Provider | Default Model |
|---|---|
| `anthropic` | `anthropic:claude-sonnet-4-6` |
| `openai` | `openai:gpt-4o` |
| `google-genai` | `google-genai:gemini-2.5-pro` |
| `groq` | `groq:llama-3.3-70b` |
| `deepseek` | `deepseek:deepseek-chat` |

All subagents inherit the same model — no per-agent overrides.

---

## File Structure

```
src/
├── index.ts                     # Entry point: load config, start PinchTab, REPL
├── agent.ts                     # createDeepAgent() — the brain + subagents
├── api.ts                       # AgentAPI class (Electron-ready)
├── repl.ts                      # REPL for testing (streaming + HITL)
├── types.ts                     # Shared types
├── config/
│   ├── env.ts                   # .env loading, provider detection
│   ├── providers.ts             # Single provider → model string + retry
│   ├── subagents.ts             # 3 subagents (browser, stealth, researcher)
│   ├── hitl.ts                  # Trust levels, interruptOn rules
│   └── mcp.ts                   # Patchright MCP setup
├── services/
│   ├── browser/
│   │   ├── pinchtab-client.ts   # PinchTab HTTP client
│   │   ├── pinchtab-tools.ts    # 15 LangChain tool() wrappers
│   │   └── lifecycle.ts         # PinchTab process management
│   └── browser-router.ts        # Custom middleware: route by agent name
├── tools/
│   ├── internet-search.ts       # Tavily search
│   ├── ask-user.ts              # Ask user via interrupt()
│   └── datetime.ts              # Current date/time
├── skills/
│   ├── web-scraping/SKILL.md
│   ├── form-filling/SKILL.md
│   ├── job-application/SKILL.md
│   ├── video-editing/SKILL.md
│   └── site-monitoring/SKILL.md
└── AGENTS.md                    # Memory: agent identity, constraints

agent-workspace/                 # Runtime — FilesystemBackend
├── uploads/                     # User files for browser upload (resume, images)
├── downloads/                   # Files downloaded from browser
├── screenshots/                 # Browser screenshots (vision + records)
└── research/                    # Researcher agent output

# Note: /memories/ lives in StoreBackend (InMemoryStore), not on disk.
# The agent reads/writes these via virtual filesystem:
#   /memories/site-patterns.md
#   /memories/form-mappings.md
#   /memories/failed-approaches.md
#   /memories/user-corrections.md
# They persist across threads via InMemoryStore (in RAM while app runs).
# Future: swap InMemoryStore → PostgresStore for true persistence.
```

---

## Implementation Phases

### Phase 1: Foundation ✅ DONE

**Files**: `types.ts`, `config/env.ts`, `config/providers.ts`, `.env.example`

1. ✅ **`src/types.ts`** — Provider, TrustLevel, AtehnaConfig, all PinchTab req/res types, AgentAPI event types
2. ✅ **`src/config/env.ts`** — .env loading, auto-detect provider from API key, validation with clear errors
3. ✅ **`src/config/providers.ts`** — getModelString(), createModel(), validateProviderInstalled()
4. ✅ **`.env.example`** — consumer-friendly config template
5. ✅ **TypeScript compiles clean** — zero errors

---

### Phase 2: Browser Service ✅ DONE

**Files**: `services/browser/pinchtab-client.ts`, `pinchtab-tools.ts`, `lifecycle.ts`

4. ✅ **PinchTab HTTP client** — PinchTabClient class, all endpoints (navigate, snapshot, click, fill, type, press, hover, scroll, eval, screenshot, text, pdf, tabs, close), health check, timeout, error handling
5. ✅ **15 LangChain tools** — Zod schemas, descriptions, sensitive field detection in browserFill, vision support in browserScreenshot
6. ✅ **Lifecycle manager** — auto-start/connect, health check polling, graceful shutdown, reconnect logic
7. ✅ **TypeScript compiles clean**

---

### Phase 3: MCP + Middleware + Tools ✅ DONE

**Files**: `config/mcp.ts`, `services/browser-router.ts`, `tools/*.ts`

8. ✅ **Patchright MCP** — dynamic import with graceful fallback if not installed, `patchright-mcp` via stdio
9. ✅ **BrowserRouter middleware** — AgentMiddleware with wrapToolCall hook, pass-through with logging hook point
10. ✅ **internet-search.ts** — Tavily with fallback stub if not installed
11. ✅ **ask-user.ts** — ask_user tool (HITL interrupt flow, non-interactive fallback)
12. ✅ **datetime.ts** — date, time, timezone, unix timestamp
13. ✅ **TypeScript compiles clean**

---

### Phase 4: HITL + Subagents ✅ DONE

**Files**: `config/hitl.ts`, `config/subagents.ts`

10. ✅ **Trust levels** — `buildInterruptOn(trustLevel)` — strict (all browser tools), moderate (fill + eval), permissive (eval only)
11. ✅ **3 subagents** — `createSubagents(deps)` factory function
    - browser-agent: 15 PinchTab tools + web-scraping + form-filling skills + moderate HITL
    - stealth-agent: Patchright MCP tools (graceful fallback if not installed)
    - researcher: search + navigate/snapshot/text + web-scraping skill
12. ✅ **TypeScript compiles clean**

---

### Phase 5: Agent Assembly + API ✅ DONE

**Files**: `agent.ts`, `api.ts`

12. ✅ **`src/agent.ts`** — createAtehnaAgent() with full config
    ```typescript
    export function createAtehnaAgent(config: AtehnaConfig) {
      const model = getModel(config);
      const store = new InMemoryStore();

      const backend = new CompositeBackend(
        new StateBackend(),
        {
          "/memories/": new StoreBackend({ state: {}, store }, {
            namespace: ["atehna", "memories"]
          }),
          "/workspace/": new FilesystemBackend({
            rootDir: "./agent-workspace"
          }),
        }
      );

      return createDeepAgent({
        name: "atehna",
        model,
        systemPrompt: BRAIN_PROMPT,  // SEE→PLAN→ACT→VERIFY instructions
        tools: [dateTimeTool, askUser],
        subagents: [browserAgent, stealthAgent, researcher],
        middleware: [browserRouterMiddleware],
        backend,
        checkpointer: new MemorySaver(),
        store,
        interruptOn: buildInterruptOn(config.trustLevel),
        memory: ["/AGENTS.md"],
        skills: ["/skills/"],
      });
    }
    ```

    **System prompt** (the brain):
    ```
    You are Atehna — a browser automation agent.

    You CANNOT interact with the browser directly.
    You delegate ALL browser actions to your subagents.

    ## Your Loop

    For every step of every task, follow this cycle:

    1. SEE:    Ask browser-agent to snapshot the current page
    2. PLAN:   Analyze what's on the page. Decide next action.
    3. ACT:    Tell browser-agent to perform the action (click, fill, etc.)
    4. VERIFY: Ask browser-agent to snapshot again. Confirm it worked.

    If verification fails:
    - Try a different approach (different element, different method)
    - If stuck after 3 attempts, ask the user via ask_user

    ## Subagents

    - browser-agent: your primary hands. Use for ALL normal browser interaction.
    - stealth-agent: use ONLY when browser-agent reports being blocked by
      bot detection (Cloudflare, CAPTCHA, etc.)
    - researcher: use when you need information NOT on the current page
      (background research, comparisons, reviews)

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

    ## Error Recovery

    - If browser-agent reports "blocked by Cloudflare/bot detection"
      → switch to stealth-agent for that site
    - If browser-agent reports "element not found" or "page error"
      → ask it to re-snapshot, try different approach
    - If stuck after 3 retries on same step → ask_user for guidance
    - If PinchTab connection fails → it will auto-reconnect, just retry

    ## Files

    - User uploads are in /workspace/uploads/ — pass path to browser-agent
    - Browser-agent saves screenshots to /workspace/screenshots/
    - Research data goes to /workspace/research/
    - Downloads go to /workspace/downloads/
    - Always mention produced files in your final response to user

    ## Rules

    - ALWAYS plan with write_todos before starting
    - ALWAYS verify after acting — never assume success
    - ALWAYS check /memories/ before working on a known site
    - ALWAYS save learnings after task completion
    - Keep your messages to the user concise
    ```

13. ✅ **`src/api.ts`** — AgentAPI class (EventEmitter)
    - `create()` → init PinchTab + MCP + search + agent
    - `invoke(task)` → single-shot execution
    - `stream(task)` → streaming with `subgraphs: true`, agent switch detection
    - `resume(threadId, decision)` → HITL resume via Command
    - `getState(threadId)` → inspect state
    - `switchProvider(provider, apiKey)` → hot-swap provider
    - `shutdown()` → cleanup PinchTab + agent
    - Events: `"token"`, `"agent_switch"`, `"hitl_request"`, `"complete"`, `"error"`
14. ✅ **TypeScript compiles clean**

---

### Phase 6: Skills + Memory ✅ DONE

**Files**: `skills/*/SKILL.md`, `AGENTS.md`

14. ✅ **5 skill files** — web-scraping, form-filling, job-application, video-editing, site-monitoring
15. ✅ **AGENTS.md** — agent identity, architecture, core loop, constraints, user interaction rules
16. ✅ **agent-workspace/** directories — uploads, downloads, screenshots, research (with .gitkeep)

---

### Phase 7: REPL + Entry Point ✅ DONE

**Files**: `repl.ts`, `index.ts`

17. ✅ **REPL** — streaming display, agent switch labels, HITL approval UI (approve/edit/reject), commands (/help, /config, /thread, /new, /exit)
18. ✅ **Entry point** — load config, create AgentAPI, init all deps, start REPL, graceful shutdown
19. ✅ **TypeScript compiles clean**

---

### Phase 8: Install + Test ✅ DONE

18. ✅ **Install deps** — pinchtab, tsx; @langchain/tavily, @langchain/google-genai already present
19. ✅ **package.json** — name, version, type:module, scripts (start, build, typecheck)
20. ✅ **Smoke test** — config loads, provider detects, model resolves, PinchTab error is clean
21. ✅ **.gitignore** — agent-workspace/* excluded, .gitkeep preserved
22. ✅ **TypeScript compiles clean**

---

## SDK Feature Coverage (37/37)

| # | Feature | Where |
|---|---|---|
| 1 | `createDeepAgent()` | `agent.ts` |
| 2 | `name` | `agent.ts` ("atehna") |
| 3 | `model` (string) | `providers.ts` — single provider |
| 4 | `systemPrompt` | `agent.ts` — SEE/PLAN/ACT/VERIFY brain |
| 5 | `tools` | datetime, ask_user |
| 6 | `subagents` (SubAgent) | 3 subagents |
| 7 | General-purpose (default) | SDK auto-includes |
| 8 | Per-subagent `tools` | browser tools, MCP tools, search |
| 9 | Per-subagent `skills` | web-scraping, form-filling per agent |
| 10 | Per-subagent `interruptOn` | browser-agent HITL |
| 11 | `lc_agent_name` | REPL streaming display |
| 12 | `middleware` (custom) | browser-router |
| 13 | CompositeBackend | `agent.ts` |
| 14 | StateBackend | default route |
| 15 | StoreBackend | /memories/ |
| 16 | FilesystemBackend | /workspace/ |
| 17 | `checkpointer` | MemorySaver |
| 18 | `store` | InMemoryStore |
| 19 | `interruptOn` | hitl.ts |
| 20 | `interrupt()` in tools | pinchtab-tools.ts |
| 21 | Batched interrupts | repl.ts |
| 22 | Edit tool args | repl.ts |
| 23 | `memory` | AGENTS.md |
| 24 | `skills` | 5 skill dirs |
| 25 | `contextSchema` | agent.ts |
| 26 | Streaming (messages) | repl.ts |
| 27 | Streaming (subgraphs) | repl.ts |
| 28-33 | 6 auto middleware | SDK |
| 34-36 | 3 opt-in middleware | configured |
| 37 | Tool result eviction | SDK auto |

---

## The Complete Task Flow

```
User: "Do X on website Y"
  │
  ▼
MAIN AGENT (brain)
  │
  ├─ RECALL: read_file("/memories/site-patterns.md")
  │          → "website Y: login is 2-step, search box is [e3]"
  │
  ├─ PLAN: write_todos → break task into steps
  │        (informed by memories of this site)
  │
  ├─ For each step:
  │   │
  │   ├─ SEE:    task(browser-agent, "snapshot page")
  │   │          ← "Page has [e0] search box, [e1] login, [e2] nav..."
  │   │
  │   ├─ PLAN:   "I see search box [e0], I need to search for Z"
  │   │
  │   ├─ ACT:    task(browser-agent, "fill [e0] with Z, click [e3]
  │   │          NOTE from memory: search button is [e3] not [e4]")
  │   │          ← "Filled and clicked. Page loading..."
  │   │          ⚠ HITL if sensitive field → pause → user approves
  │   │
  │   └─ VERIFY: task(browser-agent, "snapshot, confirm search results")
  │              ← "Results page showing 10 items for Z"
  │              ✓ Verified → next step
  │              ✗ Failed → replan, try different approach
  │                         save failure to /memories/failed-approaches.md
  │
  ├─ If bot blocked: switch to stealth-agent
  ├─ If need external info: delegate to researcher
  ├─ If HITL edit/reject: save to /memories/user-corrections.md
  │
  ├─ LEARN: save new patterns to /memories/
  │         "website Y: checkout has 3 steps, address → payment → confirm"
  │
  ├─ Save results to /workspace/
  │
  └─ Return concise result to user (with file paths)
```

### Memory in Task Delegation

The key insight: **subagents are ephemeral** — they don't read /memories/ themselves.
The main agent is the memory carrier. It reads memories and passes relevant context
into the task description.

```
WITHOUT memory:
  task(browser-agent, "Log in to LinkedIn")
  → browser-agent discovers 2-step login by trial and error (slow, might fail)

WITH memory:
  main agent reads: /memories/site-patterns.md → "LinkedIn: 2-step login"
  task(browser-agent, "Log in to LinkedIn.
    CONTEXT: LinkedIn uses 2-step login — email first, then password
    on a separate page. Snapshot after each step to verify.")
  → browser-agent gets it right first try
```

This turns every past experience into a shortcut for future tasks.

---

## Out of Scope (future)

- Electron UI (AgentAPI ready)
- HTTP server / REST endpoints
- PostgresSaver / PostgresStore
- Multi-model routing (different model per subagent)
- Custom PII/limit middleware
- Ollama local models
