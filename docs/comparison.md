# Deep Agents — Comparisons

## Deep Agent vs LangChain Agent

|                        | LangChain Agent           | Deep Agent                                    |
|------------------------|---------------------------|-----------------------------------------------|
| What it is             | Basic LLM + tool loop     | LangChain agent + 6 built-in middleware       |
| Planning               | You build it yourself     | Built-in `write_todos` tool, automatic        |
| Context overflow       | Your problem              | Virtual FS catches large outputs              |
| Delegation             | Single agent does all     | Subagents with context isolation              |
| Memory                 | Manual setup              | Built-in AGENTS.md + cross-thread persistence |
| Summarization          | Not included              | Auto-compresses old messages                  |
| Malformed tool calls   | Crashes                   | PatchToolCallsMiddleware auto-fixes           |
| HITL                   | Manual interrupt logic    | Declarative `interruptOn` per tool            |
| Setup                  | ~50-100 lines boilerplate | `createDeepAgent()` — one function            |

**In short:**
- LangChain agent = engine only. You build the car.
- Deep Agent = engine + chassis + safety systems + GPS. You just drive.

---

## Similar Agent Frameworks

| Framework              | Language   | Key Idea                    | Multi-Agent   | Planning    | Context Mgmt               |
|------------------------|------------|-----------------------------|---------------|-------------|-----------------------------|
| **Deep Agents**        | TypeScript | LangGraph + batteries       | Subagents     | Built-in    | Virtual FS + summarization  |
| **OpenAI Agents SDK**  | Python     | OpenAI-native agents        | Handoffs      | Tracing     | Built-in                    |
| **Google ADK**         | Python     | Gemini-native agents        | Sub-agents    | Built-in    | Session memory              |
| **CrewAI**             | Python     | Role-based multi-agent      | Crews + roles | Delegation  | Shared memory               |
| **AutoGen (Microsoft)**| Python     | Multi-agent conversations   | Chat groups   | Nested chats| Teachable agents            |
| **Mastra**             | TypeScript | TS-first agent framework    | Workflows     | Built-in    | Memory + RAG                |
| **Vercel AI SDK**      | TypeScript | Frontend-focused agents     | Multi-step    | Streaming   | Generative UI               |
| **Smolagents (HF)**    | Python     | Minimal, code-first         | Multi-agent   | CodeAgent   | Lightweight                 |
| **Phidata**            | Python     | Production agents           | Teams         | Built-in    | Knowledge + storage         |
| **Agency Swarm**       | Python     | Swarm architecture          | Hierarchy     | Shared state| Communication flows         |

---

## Which Framework to Pick?

### TypeScript projects:
- **Deep Agents** — most complete, LangGraph ecosystem
- **Mastra** — good for workflows + RAG built-in
- **Vercel AI SDK** — best for frontend/Next.js apps

### Python projects:
- **OpenAI Agents SDK** — simplest if on OpenAI
- **Google ADK** — best for Gemini
- **CrewAI** — best for role-based multi-agent teams
- **AutoGen** — best for complex agent-to-agent conversations

### For Gemini + TypeScript:
Deep Agents is the best choice — only mature TypeScript agent SDK with full context management that works with Gemini via `google-genai:` prefix.

---

## Deep Agents Ecosystem

| Package          | What It Is                        | Ready to Use?                    |
|------------------|-----------------------------------|----------------------------------|
| `deepagents`     | SDK — building blocks             | No, you build your own agent     |
| `deepagents-acp` | ACP server for IDEs (Zed, JetBrains) | Yes, but IDE integration only |
| `@langchain/daytona` | Daytona sandbox backend       | Plugin/backend for safe execution|

**There is no ready-made terminal coding agent.** Deep Agents is a toolkit — you assemble the pieces yourself.

### deepagents-acp Usage

```bash
npm install deepagents-acp
npx deepagents-acp --name my-agent --workspace .
```

Programmatic:

```typescript
import { startServer } from "deepagents-acp";

await startServer({
  agents: {
    name: "coding-assistant",
    description: "AI coding assistant",
    skills: ["./skills/"],
  },
  workspaceRoot: process.cwd(),
});
```

Zed IDE config:

```json
{
  "agent": {
    "profiles": {
      "deepagents": {
        "name": "DeepAgents",
        "command": "npx",
        "args": ["deepagents-acp"]
      }
    }
  }
}
```
