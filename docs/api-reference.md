# Deep Agents — API Reference

## createDeepAgent()

Main factory function. Creates a fully-configured deep agent.

```typescript
import { createDeepAgent } from "deepagents";

const agent = createDeepAgent({
  model: "google-genai:gemini-3.1-pro-preview",
  systemPrompt: "You are a helpful assistant.",
  tools: [myTool],
  subagents: [researcher, coder],
  backend: new LocalShellBackend({ rootDir: "." }),
  checkpointer: new MemorySaver(),
  store: new InMemoryStore(),
  interruptOn: { execute: true },
  memory: ["./AGENTS.md"],
  skills: ["./skills/"],
  middleware: [customMiddleware],
});
```

### Config Options

| Option         | Type                                    | Default                       | Description                                          |
|----------------|-----------------------------------------|-------------------------------|------------------------------------------------------|
| model          | `string \| BaseLanguageModel`           | `"claude-sonnet-4-5-20250929"`| Model name or instance                               |
| tools          | `StructuredTool[]`                      | `[]`                          | Custom LangChain tools                               |
| systemPrompt   | `string \| SystemMessage`              | Built-in prompt               | System prompt                                        |
| middleware     | `AgentMiddleware[]`                     | `[]`                          | Additional middleware (after defaults)                |
| subagents      | `(SubAgent \| CompiledSubAgent)[]`     | `[]`                          | Subagent specifications                              |
| backend        | `BackendProtocol \| BackendFactory`    | `StateBackend`                | Filesystem backend                                   |
| checkpointer   | `BaseCheckpointSaver \| boolean`       | `undefined`                   | State persistence (required for HITL)                |
| store          | `BaseStore`                             | `undefined`                   | Long-term memory store                               |
| interruptOn    | `Record<string, boolean \| Config>`    | `undefined`                   | Human-in-the-loop per tool                           |
| memory         | `string[]`                              | `undefined`                   | Paths to AGENTS.md files                             |
| skills         | `string[]`                              | `undefined`                   | Skill source directories                             |
| responseFormat | `SupportedResponseFormat`               | `undefined`                   | Structured output (Zod schema)                       |
| contextSchema  | `AnnotationRoot \| InteropZodObject`   | `undefined`                   | Context schema (not persisted)                       |
| name           | `string`                                | `undefined`                   | Agent name                                           |

---

## Exported Functions

| Function                           | Purpose                                              |
|------------------------------------|------------------------------------------------------|
| `createDeepAgent()`                | Main factory — creates a fully-configured deep agent |
| `createFilesystemMiddleware()`     | Filesystem middleware (ls, read, write, edit, etc.)  |
| `createSubAgentMiddleware()`       | Subagent middleware with `task` tool                 |
| `createSummarizationMiddleware()`  | Conversation summarization                           |
| `createMemoryMiddleware()`         | Memory loading from AGENTS.md files                  |
| `createSkillsMiddleware()`         | Skill loading/injection                              |
| `createPatchToolCallsMiddleware()` | Patches dangling tool calls                          |
| `createSettings()`                 | Project detection and path management                |
| `findProjectRoot()`               | Walks up tree to find `.git`                         |
| `isSandboxBackend()`              | Type guard for SandboxBackendProtocol                |
| `parseSkillMetadata()`             | Parse YAML frontmatter from SKILL.md                 |
| `listSkills()`                     | List skills from directories                         |

---

## Exported Classes

| Class              | Purpose                                          |
|--------------------|--------------------------------------------------|
| `StateBackend`     | Ephemeral in-memory backend (per-thread)         |
| `StoreBackend`     | Persistent backend via LangGraph BaseStore        |
| `FilesystemBackend`| Direct filesystem read/write                     |
| `LocalShellBackend`| Filesystem + shell execute()                     |
| `CompositeBackend` | Routes file ops by path prefix                   |
| `BaseSandbox`      | Abstract base for sandboxed backends             |
| `SandboxError`     | Custom error with structured codes               |

---

## SubAgent Interface

```typescript
interface SubAgent {
  name: string;                              // Required: identifier
  description: string;                       // Required: shown to model
  systemPrompt: string;                      // Required: prompt for subagent
  tools?: StructuredTool[];                  // Override default tools
  model?: LanguageModelLike | string;        // Override default model
  middleware?: AgentMiddleware[];             // Additional middleware
  interruptOn?: Record<string, boolean>;     // HITL config
  skills?: string[];                         // Skill paths
  responseFormat?: SupportedResponseFormat;  // Structured output
}
```

### CompiledSubAgent (pre-built LangGraph graphs)

```typescript
interface CompiledSubAgent {
  name: string;
  description: string;
  runnable: ReactAgent | Runnable;
}
```

---

## BackendProtocol Interface

```typescript
interface BackendProtocol {
  lsInfo(path: string): MaybePromise<FileInfo[]>;
  read(filePath: string, offset?: number, limit?: number): MaybePromise<string>;
  readRaw(filePath: string): MaybePromise<FileData>;
  grepRaw(pattern: string, path?: string, glob?: string): MaybePromise<GrepMatch[] | string>;
  globInfo(pattern: string, path?: string): MaybePromise<FileInfo[]>;
  write(filePath: string, content: string): MaybePromise<WriteResult>;
  edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean): MaybePromise<EditResult>;
}
```

### SandboxBackendProtocol (extends BackendProtocol)

```typescript
interface SandboxBackendProtocol extends BackendProtocol {
  execute(command: string): MaybePromise<ExecuteResponse>;
  readonly id: string;
}
```

---

## Backend Constructors

### LocalShellBackend

```typescript
new LocalShellBackend({
  rootDir?: string,           // Default: process.cwd()
  virtualMode?: boolean,      // Default: false
  timeout?: number,           // Default: 120 seconds
  maxOutputBytes?: number,    // Default: 100_000
  env?: Record<string, string>,
  inheritEnv?: boolean,       // Default: false
  initialFiles?: Record<string, string>,
})
```

### StoreBackend

```typescript
new StoreBackend(stateAndStore, {
  namespace?: string[],  // e.g. ["memories", orgId, userId, "filesystem"]
})
```

### CompositeBackend

```typescript
new CompositeBackend(
  defaultBackend,                          // BackendProtocol
  routes: Record<string, BackendProtocol>  // e.g. { "/memories/": storeBackend }
)
```

---

## Built-in Tool Schemas

| Tool         | Input Schema                                                             |
|--------------|--------------------------------------------------------------------------|
| `ls`         | `{ path?: string }`                                                      |
| `read_file`  | `{ file_path: string, offset?: number, limit?: number }`                |
| `write_file` | `{ file_path: string, content?: string }`                                |
| `edit_file`  | `{ file_path: string, old_string: string, new_string: string, replace_all?: boolean }` |
| `glob`       | `{ pattern: string, path?: string }`                                     |
| `grep`       | `{ pattern: string, path?: string, glob?: string }`                      |
| `execute`    | `{ command: string }` (sandbox backend only)                             |
| `write_todos`| `{ todos: Array<{ content: string, status: "pending" \| "in_progress" \| "completed" }> }` |
| `task`       | `{ description: string, subagent_type: string }`                         |

---

## Human-in-the-Loop

Requires a **checkpointer** (mandatory).

```typescript
interruptOn: {
  execute: true,                                          // all decisions
  write_file: { allowedDecisions: ["approve", "edit"] },  // no reject
  read_file: false,                                       // no interrupt
}
```

Flow: agent hits tool -> pauses -> returns `__interrupt__` -> user approves/edits/rejects -> resume with Command object + same thread ID.

---

## Streaming

```typescript
for await (const [namespace, mode, data] of agent.stream(input, { subgraphs: true })) {
  // namespace = [] (main) or ["tools:id"] (subagent)
  // mode = "updates" | "messages" | "custom"
}
```

| Mode     | What You Get                                    |
|----------|-------------------------------------------------|
| updates  | Node-completion events, subagent completions    |
| messages | Token-by-token from main + all subagents        |
| custom   | Arbitrary signals from tools via config.writer  |

---

## Middleware Options

### FilesystemMiddleware

```typescript
createFilesystemMiddleware({
  backend?: BackendProtocol | BackendFactory,
  systemPrompt?: string | null,
  customToolDescriptions?: Record<string, string> | null,
  toolTokenLimitBeforeEvict?: number | null,  // Default: 20000 tokens
})
```

### SummarizationMiddleware

```typescript
createSummarizationMiddleware({
  model: string | BaseChatModel,       // Required
  backend: BackendProtocol,            // Required
  trigger?: ContextSize,               // When to summarize
  keep?: ContextSize,                  // How much to keep (default: last 20 messages)
  summaryPrompt?: string,
})
```

### MemoryMiddleware

```typescript
createMemoryMiddleware({
  backend: BackendProtocol,    // Required
  sources: string[],           // Required: e.g. ["~/.deepagents/AGENTS.md"]
  addCacheControl?: boolean,   // Default: false
})
```

### SkillsMiddleware

```typescript
createSkillsMiddleware({
  backend: BackendProtocol,    // Required
  sources: string[],           // Required: e.g. ["/skills/"]
})
```
