# Atehna Deep Agent — Browser Automation Agent Design Spec

**Date**: 2026-03-18
**Status**: Draft
**Scope**: Full production-grade browser automation agent using Deep Agents SDK with 100% feature coverage

---

## 1. Overview

Atehna is an advanced, general-purpose browser automation agent built on the Deep Agents SDK (LangChain + LangGraph). It can perform any task a human can do in a browser — from simple page navigation to complex multi-step workflows like job applications, video editing, form filling, web research, and site monitoring.

### Key Properties

- **Dual browser backend**: PinchTab (primary, fast, token-efficient) + Patchright MCP (stealth, anti-detection)
- **Multi-provider**: Anthropic, OpenAI, Groq, DeepSeek, Ollama (cloud) with automatic fallback
- **Three interfaces**: CLI (single-shot), REPL (interactive), AgentAPI (Electron-ready)
- **Full HITL**: Tiered approval — always-ask for sensitive actions, configurable for the rest, interactive + non-interactive modes
- **100% Deep Agents SDK usage**: All 34 SDK features used + 21 custom-built features
- **Production-grade**: Full error handling, retries, PII protection, cost limits, streaming, persistence (custom middleware where SDK doesn't provide)

---

## 2. Architecture

### Three-Layer Design

```
Layer 3: Interfaces (CLI / REPL / AgentAPI)
    ↕ invoke / stream / Command(resume)
Layer 2: Deep Agent (createDeepAgent — all features)
    ↕ tool calls
Layer 1: Core Services (BrowserService, ProviderService, ConfigService)
```

**Principle**: Layer 2 is the product. Layer 1 is reusable infrastructure. Layer 3 is disposable — swap CLI for Electron without touching Layers 1-2.

### Layer 3: Interfaces

#### CLI (`src/cli.ts`)
- Single-shot mode: `npx ts-node src/index.ts "go to google and search for AI news"`
- Proper arg parsing (task string, --mode, --provider, --non-interactive, --verbose, --help)
- Exit codes: 0 success, 1 error, 2 HITL rejected in non-interactive
- Output: final result to stdout, progress to stderr

#### REPL (`src/repl.ts`)
- Interactive readline interface with streaming token display
- HITL approval UI: shows pending actions, allows approve/edit/reject
- Batched interrupt display for multiple simultaneous actions
- Command history (readline history file)
- Special commands: `/quit`, `/status`, `/mode`, `/trust`, `/screenshot`
- Graceful shutdown on Ctrl+C (closes PinchTab, saves state)
- Shows which subagent is active via `lc_agent_name` metadata

#### AgentAPI (`src/api.ts`)
- Clean TypeScript class with typed methods
- Methods: `invoke()`, `stream()`, `resume()`, `configure()`, `getState()`, `shutdown()`
- EventEmitter for streaming events
- No I/O assumptions — Electron imports this class directly
- Thread management: create, list, switch, delete threads

### Layer 2: Deep Agent

Single `createDeepAgent()` call in `src/agent.ts` that wires together everything.

#### Main Agent Config

```typescript
createDeepAgent({
  name: "atehna",
  model: /* from ProviderService — default anthropic:claude-sonnet-4-6 */,
  systemPrompt: /* detailed orchestrator prompt */,
  tools: [dateTimeTool, internetSearch, ...customTools],
  subagents: [/* 6 subagents */],
  middleware: [/* 10 custom middleware — SDK auto-includes 6 more */],
  backend: /* CompositeBackend */,
  checkpointer: new MemorySaver(),
  store: new InMemoryStore(),
  memory: ["/AGENTS.md"],
  skills: ["/skills/"],
  interruptOn: {/* tiered HITL rules */},
  contextSchema: /* Zod: mode, trustLevel, targetUrls */,
  responseFormat: /* optional, per-task structured output */,
})
```

#### System Prompt

The main agent is an orchestrator/planner. Its system prompt instructs it to:
- Break complex tasks into steps using `write_todos`
- Delegate browser work to the appropriate subagent (browser-agent for normal sites, stealth-agent for bot-protected sites)
- Delegate research to researcher-agent
- Delegate form filling to form-agent
- Delegate media work to media-agent
- Save important findings to `/memories/` for cross-thread persistence
- Use the filesystem to store large outputs, screenshots, reports
- Always snapshot before acting on a page
- Return concise results to the user

#### Context Schema

```typescript
contextSchema: z.object({
  mode: z.enum(["interactive", "non-interactive"]).default("interactive"),
  trustLevel: z.enum(["strict", "moderate", "permissive"]).default("moderate"),
  targetUrls: z.array(z.string()).optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  // Per-subagent namespaced
  "browser-agent:maxTabs": z.number().optional(),
  "form-agent:autoFillDefaults": z.boolean().optional(),
  "stealth-agent:proxyUrl": z.string().optional(),
})
```

### Layer 1: Core Services

#### BrowserService (`src/services/browser/`)

##### PinchTab Client (`pinchtab-client.ts`)
- Full HTTP client for PinchTab API at `localhost:9867`
- All endpoints: `/navigate`, `/snapshot`, `/click`, `/fill`, `/type`, `/press`, `/hover`, `/scroll`, `/eval`, `/screenshot`, `/text`, `/pdf`, `/tabs`, `/close`, `/profiles`, `/instances`
- Typed request/response interfaces for every endpoint
- Error handling: connection refused (PinchTab not running), timeout, HTTP errors
- Configurable timeout (default 30s), base URL
- Health check endpoint polling

##### PinchTab Tools (`pinchtab-tools.ts`)
- LangChain `tool()` wrappers for every PinchTab action
- Each tool has: full Zod schema, detailed description, proper error messages
- `browserSnapshot`: returns accessibility tree with element refs, options for filter (all/interactive/visible)
- `browserNavigate`: navigate to URL, wait for load
- `browserClick`: click element by ref (e0, e1...)
- `browserFill`: fill input field by ref — includes `interrupt()` for sensitive fields (password, card, CVV, SSN)
- `browserType`: type text character by character
- `browserPress`: press keyboard keys (Enter, Tab, Escape...)
- `browserScroll`: scroll page or element
- `browserHover`: hover over element
- `browserScreenshot`: capture screenshot, returns as image for vision models
- `browserText`: extract visible text content (~800 tokens/page)
- `browserPdf`: save page as PDF to `/workspace/`
- `browserEval`: execute JavaScript in page context (always requires HITL approval)
- `browserTabs`: list open tabs
- `browserClose`: close a tab

##### Patchright MCP Integration (`patchright-mcp.ts`)
- CompiledSubAgent wrapping Patchright MCP server
- Connects via MCP protocol
- Used as stealth-agent runnable
- Provides same conceptual actions (navigate, click, fill, etc.) but through Patchright's anti-detection browser

##### Lifecycle Manager (`lifecycle.ts`)
- On agent startup: check if PinchTab is running (health check `GET /`)
- If not running: spawn PinchTab process, wait for health check to pass
- If running: connect to existing instance
- On agent shutdown: optionally kill spawned PinchTab process
- Reconnection logic on connection loss
- Configurable: auto-start (default true), PinchTab binary path, port

#### ProviderService (`src/config/providers.ts`)
- Loads provider API keys from `.env`
- Validates: at least one provider must be configured
- Creates model instances with connection resilience (`maxRetries: 10`, `timeout: 120_000`)
- Model routing map: returns the configured model for each subagent role
- Falls back gracefully if a configured provider's key is missing
- Supported: Anthropic, OpenAI, Groq, DeepSeek, Ollama (cloud)

#### ConfigService (`src/config/env.ts`, `src/config/hitl.ts`)
- `.env` loading with `dotenv`
- Validation with clear error messages for missing/invalid values
- Trust level configuration for HITL
- Default trust levels:
  - `strict`: approve everything
  - `moderate`: approve sensitive actions (fill, eval, execute), auto-approve navigation/snapshot
  - `permissive`: auto-approve most, only ask for payments/sign-in
- Interactive/non-interactive mode handling

---

## 3. Middleware Stack

### 3.1–3.6 Auto-included by createDeepAgent (SDK)
1. **TodoListMiddleware** — planning via write_todos
2. **FilesystemMiddleware** — virtual FS (ls, read, write, edit, glob, grep)
3. **SubAgentMiddleware** — subagent spawning via task tool
4. **SummarizationMiddleware** — context compression
5. **AnthropicPromptCachingMiddleware** — cost savings with Claude
6. **PatchToolCallsMiddleware** — fix malformed tool calls

### 3.7–3.9 Opt-in via createDeepAgent args (SDK)
7. **MemoryMiddleware** (from `memory: ["/AGENTS.md"]`)
8. **SkillsMiddleware** (from `skills: ["/skills/"]`)
9. **HumanInTheLoopMiddleware** (from `interruptOn: {...}`)

### 3.10 Custom middleware (we build)
10. **BrowserRouterMiddleware**
    - Intercepts browser tool calls
    - Routes to PinchTab by default
    - Routes to Patchright MCP when stealth-agent is the caller (via `lc_agent_name`)

### 3.11–3.19 Custom middleware to implement (NOT in SDK)

> These capabilities do NOT exist as prebuilt middleware in `deepagents@1.8.4`.
> They must be implemented as custom middleware or via LangChain utilities.

11. **Model retry** — use LangChain's `model.withRetry()`:
    - `maxRetries: 3`, retry on rate limits (429) and server errors (5xx)
    - Exponential backoff: 1000ms initial, factor 2.0, max 60000ms

12. **Model fallback** — use LangChain's `model.withFallbacks()`:
    - Chain: `openai:gpt-4o` → `groq:llama-3.3-70b` → `deepseek:deepseek-chat`

13. **Model call limit** — custom counter middleware:
    - `threadLimit: 200`, `runLimit: 50`, graceful termination

14. **Tool call limit** — custom counter middleware:
    - Global: 100/run, `browser_click`: 30/run, `browser_navigate`: 20/run, `browser_fill`: 20/run

15. **Tool retry** — custom retry wrapper for PinchTab HTTP calls:
    - `maxRetries: 3`, `backoffFactor: 2.0`, `initialDelayMs: 500`
    - On failure: return error message, let agent recover

16. **PII redaction** — custom scanner on tool results:
    - Email: mask, Credit card: redact, API keys (`sk-...`): block input, SSN: hash

17. **LLM tool selector** — custom pre-filter middleware:
    - Model: `groq:llama-3.3-70b`, `maxTools: 8`
    - Always include: `write_todos`, `task`, `read_file`, `write_file`

18. **Context editing** — custom message trimmer:
    - Trigger at 80k tokens, keep 5 most recent tool results
    - Exclude: `write_todos`, `task`
    - Placeholder: `"[browser output cleared - use read_file if needed]"`

19. **Tool emulator** (test mode) — custom middleware for testing without real browser:
    - Activated via `ATEHNA_TEST_MODE=true` env var

---

## 4. Subagents

### 4.1 general-purpose (overridden)
- **Description**: General assistant for multi-step tasks needing context isolation
- **Model**: inherits from main agent
- **Tools**: inherits all main agent tools
- **Skills**: inherits all main agent skills
- **Purpose**: Context quarantine — delegate complex multi-step tasks, get concise result back

### 4.2 browser-agent
- **Description**: Executes browser actions via PinchTab — navigate, click, fill, type, scroll, screenshot
- **Model**: `groq:llama-3.3-70b` (fast for browser actions)
- **Tools**: all 15 PinchTab browser tools
- **Skills**: `/skills/web-scraping/`, `/skills/form-filling/`
- **interruptOn**: `browser_fill` (approve/edit/reject), `browser_eval` (approve/reject)
- **System prompt**: instructs to always snapshot before acting, use element refs, save large outputs to filesystem, return concise summaries

### 4.3 stealth-agent (CompiledSubAgent)
- **Description**: Browser automation that bypasses bot detection — use for Cloudflare, DataDome, login walls
- **Type**: CompiledSubAgent with `runnable: patchrightMCPGraph`
- **Model**: configured within the compiled graph
- **Purpose**: anti-detection browser automation for protected sites

### 4.4 researcher-agent
- **Description**: Deep web research, data gathering, and analysis
- **Model**: `anthropic:claude-sonnet-4-6` (best reasoning/synthesis)
- **Tools**: `internetSearch`, `browserNavigate`, `browserSnapshot`, `browserText`
- **Skills**: `/skills/web-scraping/`
- **System prompt**: break questions into searches, synthesize, cite sources, save raw data to `/workspace/research/`, return summary under 500 words

### 4.5 form-agent
- **Description**: Fills complex multi-step forms, job applications, sign-ups
- **Model**: `openai:gpt-4o` (good at structured form data)
- **Tools**: browser navigation + form interaction tools (navigate, snapshot, click, fill, type, press, screenshot)
- **Skills**: `/skills/form-filling/`, `/skills/job-application/`
- **interruptOn**: `browser_click` (approve/reject for submit buttons), `browser_fill` (approve/edit/reject)
- **System prompt**: snapshot first, identify fields, fill in order, handle validation errors, always pause before submit, save form data to `/memories/`

### 4.6 media-agent
- **Description**: Operates browser-based media tools for video editing, image manipulation, content creation
- **Model**: `anthropic:claude-sonnet-4-6` (vision for screenshots)
- **Tools**: all browser tools including eval and PDF
- **Skills**: `/skills/video-editing/`
- **System prompt**: navigate media editor UIs via snapshots and element refs, take screenshots to verify, save outputs to `/workspace/media/`

---

## 5. HITL (Human-in-the-Loop)

### Tiered Approval Rules

```
ALWAYS ASK (regardless of trust level):
  - browser_fill on password/card/CVV/SSN fields (via interrupt() inside tool)
  - browser_eval (arbitrary JS execution)
  - execute (shell commands)

CONFIGURABLE (based on trust level):
  strict:     approve ALL browser actions
  moderate:   approve browser_fill, browser_click (submit), browser_eval
  permissive: approve only payments/sign-in (detected via interrupt() in tool)

NEVER ASK:
  - browser_snapshot (read-only)
  - browser_text (read-only)
  - read_file (read-only)
  - write_todos (planning)
```

### Interactive Mode
- REPL displays pending actions with full details
- User can: approve, edit args, reject each action
- Batched display when multiple actions need approval simultaneously
- Timeout: 5 minutes per approval request, then reject

### Non-Interactive Mode
- Sensitive actions (password, payment): skip and log warning
- Moderate actions: auto-approve based on trust level
- All decisions logged to `/workspace/hitl-log.json`

### Custom interrupt() in Tools
- `browserFill`: detects sensitive field names (password, card, cvv, ssn) from snapshot metadata
- Shows `[REDACTED]` value in approval prompt
- Approval includes the field name and context

---

## 6. Backend Configuration

### CompositeBackend

```
/           → StateBackend     (scratch pad, ephemeral per-thread)
/memories/  → StoreBackend     (cross-thread persistent via InMemoryStore)
/workspace/ → FilesystemBackend (local disk: ./agent-workspace/)
```

### Checkpointer
- `MemorySaver` for state persistence
- Required for: HITL interrupts, pause/resume, thread management
- Thread IDs: auto-generated UUIDs, configurable via API

### Store
- `InMemoryStore` for cross-thread memory
- Persists: site patterns, login flows, form mappings, user corrections
- Accessed via `/memories/` path in virtual filesystem

---

## 7. Skills

Each skill follows the Agent Skills spec (agentskills.io) with YAML frontmatter.

### 7.1 web-scraping (`/skills/web-scraping/SKILL.md`)
- CSS selector patterns for common page structures
- Pagination detection and handling
- Rate limiting between requests
- Data extraction strategies (text, tables, lists)
- Handling dynamic content (wait for load, scroll to load)

### 7.2 form-filling (`/skills/form-filling/SKILL.md`)
- Field detection from accessibility tree
- Multi-step form navigation (next, previous, tabs)
- Validation error handling and retry
- File upload patterns
- Dropdown/select handling
- Date picker patterns
- Captcha detection (punt to user via HITL)

### 7.3 job-application (`/skills/job-application/SKILL.md`)
- LinkedIn, Indeed, Glassdoor UI patterns
- Resume upload workflow
- Cover letter field detection
- Salary/experience field mapping
- Application tracking (save to /memories/)
- Multi-application batching strategy

### 7.4 video-editing (`/skills/video-editing/SKILL.md`)
- CapCut web UI patterns
- Canva video editor patterns
- Timeline interaction (click, drag, trim)
- Asset upload and placement
- Text overlay and effects
- Export workflow and download

### 7.5 site-monitoring (`/skills/site-monitoring/SKILL.md`)
- Periodic page checking strategy
- Content diff detection
- Price monitoring patterns
- Alert conditions and thresholds
- Screenshot comparison

---

## 8. Memory

### AGENTS.md (`/AGENTS.md`)
Loaded at startup via MemoryMiddleware. Contains:
- Project description and agent identity
- User preferences (name, defaults, common sites)
- Provider notes and model preferences
- Known quirks and workarounds for specific sites
- General instructions and constraints

### Cross-thread Memory (`/memories/`)
Written by the agent during operation, persisted via StoreBackend:
- `site-patterns.json`: discovered login flows, navigation patterns
- `form-mappings.json`: field-to-value mappings for known forms
- `user-corrections.json`: things the user edited/rejected (learn from mistakes)
- `workflow-history.json`: successful workflow patterns for reuse

---

## 9. Streaming

### REPL Streaming
```typescript
for await (const event of agent.stream(input, {
  ...config,
  streamMode: "messages",
  subgraphs: true,
})) {
  // Display token-by-token with agent name prefix
  // [atehna] Planning your task...
  // [browser-agent] Navigating to linkedin.com...
  // [form-agent] Filling application form...
}
```

### AgentAPI Streaming
- EventEmitter pattern: `api.on("token", callback)`, `api.on("agent_switch", callback)`
- Same data as REPL — future Electron UI subscribes to these events

---

## 10. Provider Configuration

### Default Model Routing

| Role | Model | Why |
|---|---|---|
| Main agent | `anthropic:claude-sonnet-4-6` | Best reasoning/planning |
| browser-agent | `groq:llama-3.3-70b` | Fast for browser actions |
| stealth-agent | `deepseek:deepseek-chat` | Cost-effective |
| researcher-agent | `anthropic:claude-sonnet-4-6` | Best synthesis |
| form-agent | `openai:gpt-4o` | Good structured data |
| media-agent | `anthropic:claude-sonnet-4-6` | Vision for screenshots |
| tool-selector | `groq:llama-3.3-70b` | Fast pre-filter |
| summarization | `groq:llama-3.3-70b` | Fast compression |
| fallback chain | openai → groq → deepseek | Resilience |

### .env Configuration

```env
# Required: at least one provider
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
DEEPSEEK_API_KEY=...
OLLAMA_BASE_URL=https://...

# Optional: override model routing
ATEHNA_MAIN_MODEL=anthropic:claude-sonnet-4-6
ATEHNA_BROWSER_MODEL=groq:llama-3.3-70b
ATEHNA_RESEARCHER_MODEL=anthropic:claude-sonnet-4-6
ATEHNA_FORM_MODEL=openai:gpt-4o
ATEHNA_MEDIA_MODEL=anthropic:claude-sonnet-4-6
ATEHNA_STEALTH_MODEL=deepseek:deepseek-chat
ATEHNA_SELECTOR_MODEL=groq:llama-3.3-70b
ATEHNA_SUMMARY_MODEL=groq:llama-3.3-70b

# Optional: PinchTab
PINCHTAB_PORT=9867
PINCHTAB_AUTO_START=true
PINCHTAB_BINARY_PATH=pinchtab

# Optional: behavior
ATEHNA_TRUST_LEVEL=moderate
ATEHNA_MODE=interactive
ATEHNA_TEST_MODE=false

# Optional: observability
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=ls-...
LANGSMITH_PROJECT=atehna
```

### Connection Resilience
- All models created with `maxRetries: 10`
- `timeout: 120_000` (2 minutes)
- Paired with checkpointer for progress preservation across failures

---

## 11. File Structure

```
src/
├── index.ts                        # Entry point: routes to CLI or REPL
├── agent.ts                        # createDeepAgent() — full config
├── api.ts                          # AgentAPI class (Electron-ready)
├── cli.ts                          # CLI single-shot mode
├── repl.ts                         # Interactive REPL with streaming + HITL UI
├── config/
│   ├── env.ts                      # .env loading, validation, defaults
│   ├── providers.ts                # Multi-provider model creation + routing
│   ├── middleware.ts               # All middleware (SDK config + custom implementations)
│   ├── subagents.ts                # All 6 subagents defined
│   └── hitl.ts                     # Trust levels, HITL rule builder
├── services/
│   ├── browser/
│   │   ├── pinchtab-client.ts      # Full PinchTab HTTP client (all endpoints)
│   │   ├── pinchtab-tools.ts       # LangChain tool() wrappers (15 tools)
│   │   ├── patchright-mcp.ts       # Patchright MCP CompiledSubAgent
│   │   └── lifecycle.ts            # PinchTab process management
│   └── browser-router.ts           # Custom middleware: route to PinchTab vs Patchright
├── tools/
│   ├── internet-search.ts          # Tavily web search tool
│   └── datetime.ts                 # Date/time utility tool
├── skills/
│   ├── web-scraping/SKILL.md
│   ├── form-filling/SKILL.md
│   ├── job-application/SKILL.md
│   ├── video-editing/SKILL.md
│   └── site-monitoring/SKILL.md
├── AGENTS.md                       # Memory: project instructions
└── types.ts                        # Shared TypeScript types

agent-workspace/                    # Created at runtime
├── research/                       # Researcher output
├── media/                          # Media agent output
├── screenshots/                    # Browser screenshots
└── hitl-log.json                   # Non-interactive HITL decisions
```

---

## 12. Complete Feature Checklist

### SDK Features (34 — 100% Deep Agents coverage)

| # | Feature | Source | File |
|---|---|---|---|
| 1 | `createDeepAgent()` | SDK | `agent.ts` |
| 2 | `name` parameter | SDK | `agent.ts` ("atehna") |
| 3 | `model` (string/object) | SDK | `providers.ts` |
| 4 | `systemPrompt` | SDK | `agent.ts` |
| 5 | `tools` (custom) | SDK | `pinchtab-tools.ts`, `tools/` |
| 6 | `subagents` (SubAgent dict) | SDK | `subagents.ts` (5 dict subagents) |
| 7 | `subagents` (CompiledSubAgent) | SDK | `patchright-mcp.ts` (stealth-agent) |
| 8 | General-purpose override | SDK | `subagents.ts` |
| 9 | Skills inheritance per-subagent | SDK | `subagents.ts` |
| 10 | Per-subagent context (namespaced) | SDK | `api.ts`, `agent.ts` |
| 11 | `lc_agent_name` metadata | SDK | `repl.ts` (streaming display) |
| 12 | Per-subagent `interruptOn` | SDK | `subagents.ts` |
| 13 | `interruptOn` config | SDK | `hitl.ts` |
| 14 | `interrupt()` inside tools | SDK | `pinchtab-tools.ts` (sensitive fields) |
| 15 | Batched interrupts + edit args | SDK | `repl.ts` (HITL UI) |
| 16 | `checkpointer` (MemorySaver) | SDK | `agent.ts` |
| 17 | `store` (InMemoryStore) | SDK | `agent.ts` |
| 18 | `backend` (CompositeBackend) | SDK | `agent.ts` |
| 19 | StateBackend | SDK | `agent.ts` (default route) |
| 20 | StoreBackend | SDK | `agent.ts` (/memories/) |
| 21 | FilesystemBackend | SDK | `agent.ts` (/workspace/) |
| 22 | `memory` (AGENTS.md) | SDK | `agent.ts`, `AGENTS.md` |
| 23 | `skills` (progressive) | SDK | `agent.ts`, `skills/` |
| 24 | `responseFormat` (Zod) | SDK | `agent.ts` (per-task) |
| 25 | `contextSchema` (Zod) | SDK | `agent.ts` |
| 26 | Streaming (messages mode) | SDK | `repl.ts` |
| 27 | Streaming (subgraphs: true) | SDK | `repl.ts` |
| 28 | TodoListMiddleware | SDK (auto) | — |
| 29 | FilesystemMiddleware | SDK (auto) | — |
| 30 | SubAgentMiddleware | SDK (auto) | — |
| 31 | SummarizationMiddleware | SDK (auto) | — |
| 32 | AnthropicPromptCachingMiddleware | SDK (auto) | — |
| 33 | PatchToolCallsMiddleware | SDK (auto) | — |
| 34 | Tool result eviction | SDK (auto) | — |

### Custom Middleware (10 — we build these, NOT in SDK)

| # | Feature | Implementation | File |
|---|---|---|---|
| 35 | Model retry | LangChain `.withRetry()` | `providers.ts` |
| 36 | Model fallback | LangChain `.withFallbacks()` | `providers.ts` |
| 37 | Model call limit | Custom counter middleware | `middleware.ts` |
| 38 | Tool call limit | Custom counter middleware | `middleware.ts` |
| 39 | Tool retry | Custom retry wrapper | `middleware.ts` |
| 40 | PII redaction | Custom scanner middleware | `middleware.ts` |
| 41 | LLM tool selector | Custom pre-filter middleware | `middleware.ts` |
| 42 | Context editing | Custom message trimmer | `middleware.ts` |
| 43 | Tool emulator (test mode) | Custom emulator middleware | `middleware.ts` |
| 44 | BrowserRouterMiddleware | Custom router middleware | `browser-router.ts` |

### Infrastructure & Integration (11 — mix of LangChain native + custom)

| # | Feature | Source | File |
|---|---|---|---|
| 45 | Connection resilience (maxRetries) | LangChain native | `providers.ts` |
| 46 | Image support (screenshots) | Custom | `pinchtab-tools.ts` |
| 47 | LangSmith tracing | LangChain native | `.env` config |
| 48 | Multi-provider (5 providers) | LangChain native | `providers.ts` |
| 49 | Per-subagent model override | SDK | `subagents.ts` |
| 50 | @langchain/mcp-adapters | External package | `patchright-mcp.ts` |
| 51 | .mcp.json auto-discovery | Custom | `config/mcp.ts` |
| 52 | PinchTab browser tools (15) | Custom | `pinchtab-tools.ts` |
| 53 | internet_search (Tavily) | Custom | `tools/internet-search.ts` |
| 54 | http_request | Custom | `tools/http-request.ts` |
| 55 | ask_user | Custom | `tools/ask-user.ts` |

**34/34 SDK features used. 100% Deep Agents coverage.**
**21 additional custom-built features for full application.**

---

## 13. Dependencies

```json
{
  "dependencies": {
    "deepagents": "^1.8.4",
    "langchain": "latest",
    "@langchain/core": "latest",
    "@langchain/anthropic": "latest",
    "@langchain/openai": "latest",
    "@langchain/groq": "latest",
    "@langchain/deepseek": "latest",
    "@langchain/community": "latest",
    "@langchain/langgraph": "latest",
    "@langchain/tavily": "latest",
    "zod": "^3.23.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "ts-node": "^10.9.0",
    "@types/node": "^22.0.0"
  }
}
```

---

## 14. Out of Scope (Future)

- Electron UI (designed for plug-and-play but not implemented)
- Ollama local (cloud only for now)
- PostgresSaver/PostgresStore (using in-memory for now)
- Sandbox providers (Modal, Daytona, Deno — designed for extension)
- ACP IDE integration (API endpoints ready, integration deferred)
