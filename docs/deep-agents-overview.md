# Deep Agents — Overview

## What Is It?

An "agent harness" built on LangChain + LangGraph for production-grade LLM agents.

Ships as two packages:
1. **`deepagents`** — SDK/library for building custom agents
2. **`deepagents-acp`** — ACP server for IDE integration (Zed, JetBrains)

There is no ready-made terminal coding agent. You build your own using the SDK.

## Installation

```bash
npm install deepagents langchain @langchain/core
# Plus your provider package:
npm install @langchain/google-genai    # for Gemini
npm install @langchain/openai          # for OpenAI
npm install @langchain/anthropic       # for Claude
```

## Core Architecture

The agent loop is the standard tool-calling cycle with 5 built-in enhancement layers:

```
User Request
    |
Main Agent (LLM)
    |-- write_todos     -> plans + tracks subtasks
    |-- ls/read/write   -> virtual filesystem (avoids context overflow)
    |-- task            -> spawns subagents (context isolation)
    |-- memory          -> cross-thread persistence via LangGraph Store
    |-- custom tools    -> your tools
```

## 5 Key Components

### 1. Planning — write_todos

Built-in tool. Agent breaks complex tasks into discrete steps, checks them off as it
works. No manual planning code needed.

### 2. Virtual Filesystem (ls, read_file, write_file, edit_file, glob, grep)

Prevents context window overflow. Instead of dumping large outputs into messages,
results go to a virtual FS and the agent reads selectively.

**Backends:**

| Backend              | Persistence          | Use Case              |
|----------------------|----------------------|-----------------------|
| StateBackend         | Single thread (RAM)  | Dev/testing           |
| FilesystemBackend    | Local disk           | Persistent local work |
| LocalShellBackend    | Shell + disk         | Code agents           |
| StoreBackend         | Cross-thread (Store) | Production multi-user |
| CompositeBackend     | Route-based          | Mixed strategies      |
| BaseSandbox          | Isolated             | Safe execution        |

### 3. Subagents — Context Isolation

The `task` tool spawns specialized child agents. The main agent gets only the final
result, not the 50 intermediate tool calls the subagent made.

```typescript
subagents: [{
  name: "researcher",
  description: "Does deep web research on a topic",
  systemPrompt: "You are a research expert...",
  tools: [searchTool],
  model: "openai:gpt-4o"  // optional override
}]
```

- Subagents can have their own middleware, interruptOn, and skills
- CompiledSubAgent lets you plug in prebuilt LangGraph graphs directly

### 4. Long-term Memory

Cross-thread persistence via LangGraph Memory Store. Agent saves and retrieves info
across separate conversations. Loaded via AGENTS.md-style files.

### 5. Middleware

Default middleware stack (auto-applied):
1. **TodoList** — planning
2. **Filesystem** — virtual FS
3. **SubAgent** — delegation
4. **Summarization** — auto-compress context
5. **AnthropicPromptCaching** — cache prefixes for cost savings (Anthropic only)
6. **PatchToolCalls** — fix malformed tool calls

Custom middleware intercepts tool calls via `wrapToolCall` hooks.

## Key Design Insight

Deep Agents' core innovation over raw LangGraph is the automatic context management
pipeline:

```
planning -> virtual FS -> subagent isolation -> summarization -> memory
```

Each layer prevents a different kind of agent failure:

| Layer           | Prevents                              |
|-----------------|---------------------------------------|
| Planning        | Agent losing track of steps           |
| Virtual FS      | Context window overflow               |
| Subagents       | Distraction from intermediate steps   |
| Summarization   | Running out of context in long convos |
| Memory          | Forgetting across sessions            |
| Patch tool calls| Crashes from malformed LLM output     |
