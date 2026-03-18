# Deep Agents — Current Setup & Gap Analysis

## Project Structure

```
Deep-Agent/
  src/
    agent.ts          # Main agent file
  docs/
    deep-agents-overview.md
    api-reference.md
    providers.md
    comparison.md
    current-setup.md  # This file
  .env                # GOOGLE_API_KEY
  tsconfig.json
  package.json
```

## Current Agent Configuration (src/agent.ts)

| Setting       | Value                                      |
|---------------|--------------------------------------------|
| Model         | `google-genai:gemini-3.1-pro-preview`      |
| Backend       | `LocalShellBackend` (filesystem + shell)   |
| Custom tools  | `dateTimeTool` (1 tool)                    |
| Subagents     | `researcher`, `coder`, `tester` (3 agents) |
| interruptOn   | `execute: true`, `write_file: approve/edit`|

## Capability Coverage

### What's working (auto-included by Deep Agents):

| Capability               | Status    | Notes                          |
|--------------------------|-----------|--------------------------------|
| Planning (write_todos)   | Automatic | Built-in, no config needed     |
| Virtual FS tools         | Automatic | ls, read, write, edit, glob, grep |
| Shell execution          | Configured| LocalShellBackend              |
| Subagents (task tool)    | Configured| 3 subagents defined            |
| PatchToolCalls           | Automatic | Fixes malformed tool calls     |
| Summarization            | Automatic | Auto-compresses old messages   |
| Tool result eviction     | Automatic | Large outputs (>20k tokens) go to FS |

### What's NOT configured:

| Capability               | Status    | What's missing                 | Impact                                |
|--------------------------|-----------|--------------------------------|---------------------------------------|
| Human-in-the-loop        | BROKEN    | No `checkpointer` configured  | interruptOn config is ignored         |
| Streaming                | Missing   | Using `invoke()` not `stream()`| User sees nothing until run completes |
| Long-term memory         | Missing   | No `memory` paths configured  | No AGENTS.md loading                  |
| Store (cross-thread)     | Missing   | No `store` configured         | No persistence across conversations   |
| Checkpointer             | Missing   | No `checkpointer` configured  | No state persistence between runs     |
| Skills                   | Missing   | No `skills` paths configured  | No progressive knowledge loading      |
| Custom middleware         | Missing   | No `middleware` configured     | No hooks into tool call pipeline      |
| Structured output        | Missing   | No `responseFormat` configured | No typed/validated responses          |
| Multi-provider models    | Missing   | All subagents use same model   | No best-fit-per-task optimization     |
| Prompt caching           | N/A       | Anthropic-only feature         | Not applicable with Gemini            |

## To Fix interruptOn

The HITL config requires a checkpointer:

```typescript
import { MemorySaver } from "@langchain/langgraph-checkpoint";

const agent = createDeepAgent({
  // ...existing config...
  checkpointer: new MemorySaver(),
  interruptOn: {
    execute: true,
    write_file: { allowedDecisions: ["approve", "edit"] },
  },
});
```

## To Add Streaming

```typescript
for await (const [namespace, mode, data] of agent.stream(
  { messages: [{ role: "user", content: userInput }] },
  { subgraphs: true }
)) {
  // namespace = [] (main) or ["tools:id"] (subagent)
  // mode = "updates" | "messages" | "custom"
}
```

## To Add Memory

```typescript
const agent = createDeepAgent({
  // ...existing config...
  memory: ["./AGENTS.md", "~/.deepagents/AGENTS.md"],
  store: new InMemoryStore(),
});
```

## To Add Skills

```typescript
const agent = createDeepAgent({
  // ...existing config...
  skills: ["./skills/"],
});
```

## To Add Multi-Provider

```bash
npm install @langchain/anthropic @langchain/deepseek @langchain/groq
```

```typescript
const agent = createDeepAgent({
  model: "google-genai:gemini-3.1-pro-preview",
  subagents: [
    { name: "researcher", model: "deepseek:deepseek-chat", ... },
    { name: "coder", model: "anthropic:claude-sonnet-4-20250514", ... },
    { name: "tester", model: "groq:llama-3.3-70b", ... },
  ],
});
```

## Installed Packages

| Package                | Version | Purpose             |
|------------------------|---------|---------------------|
| `deepagents`           | 1.8.4   | Core SDK            |
| `langchain`            | 1.2.34  | LangChain framework |
| `@langchain/core`      | 1.1.33  | Core types          |
| `@langchain/google-genai`| 2.1.26| Gemini provider     |
| `@langchain/tavily`    | 1.2.0   | Search (unused)     |
| `dotenv`               | latest  | Env file loading    |
| `typescript`           | latest  | TypeScript compiler |
| `ts-node`              | latest  | TS execution        |

## Environment Variables

```
GOOGLE_API_KEY=<set in .env>
```

## Run Command

```bash
npx ts-node --esm src/agent.ts "Your prompt here"
```
