import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";

import type { AtehnaConfig, HitlDecision, TaskResult } from "./types.js";
import { loadConfig } from "./config/env.js";
import { getModelString } from "./config/providers.js";
import { validateProviderInstalled } from "./config/providers.js";
import { startPinchTab, stopPinchTab } from "./services/browser/lifecycle.js";
import { loadPatchrightMcpTools } from "./config/mcp.js";
import { createInternetSearchTool } from "./tools/internet-search.js";
import { createAtehnaAgent, type AtehnaAgent } from "./agent.js";
import { extractWorkspaceFiles } from "./services/file-tracker.js";

// ── Event Types ──────────────────────────────────────────────

export interface AgentAPIEvents {
  token: [{ agent: string; content: string }];
  agent_switch: [{ from: string; to: string }];
  hitl_request: [
    { id: string; tool: string; args: Record<string, unknown>; agent: string },
  ];
  complete: [TaskResult];
  error: [Error];
}

// ── AgentAPI Class ───────────────────────────────────────────

/**
 * AgentAPI — the interface between Atehna and external consumers (REPL, Electron).
 *
 * Manages the full lifecycle:
 * - Creates the agent with all deps (PinchTab, MCP, search)
 * - Provides invoke/stream/resume for task execution
 * - Emits events for UI consumption
 * - Handles HITL resume via Command
 */
export class AgentAPI extends EventEmitter<AgentAPIEvents> {
  private config: AtehnaConfig;
  private agent: AtehnaAgent | null = null;
  private currentThreadId: string | null = null;

  constructor(config?: AtehnaConfig) {
    super();
    this.config = config ?? loadConfig();
  }

  /** Get the current config */
  getConfig(): AtehnaConfig {
    return this.config;
  }

  /**
   * Initialize the agent and all dependencies.
   * Call this before invoke/stream.
   */
  async create(): Promise<void> {
    await validateProviderInstalled(this.config);

    if (this.agent) {
      await this.shutdown();
    }

    // 1. Start PinchTab browser
    const client = await startPinchTab({
      port: this.config.pinchtabPort,
      autoStart: this.config.pinchtabAutoStart,
      mode: this.config.pinchtabMode,
      configPath: this.config.pinchtabConfigPath,
      token: this.config.pinchtabToken,
    });

    // 2. Load optional MCP tools (stealth browser)
    const patchrightTools = await loadPatchrightMcpTools();

    // 3. Create search tool
    const searchTool = await createInternetSearchTool();

    // 4. Create the agent
    this.agent = await createAtehnaAgent({
      config: this.config,
      subagentDeps: {
        pinchTabClient: client,
        patchrightTools,
        searchTool,
      },
    });
  }

  /**
   * Run a task to completion (non-streaming).
   * Returns the final result.
   */
  async invoke(
    task: string,
    threadId?: string,
    interfaceMode: "repl" | "http" | "api" = "api",
  ): Promise<TaskResult> {
    const agent = this.ensureAgent();
    const tid = threadId ?? this.newThread();

    const result = await agent.invoke(
      { messages: [{ role: "user", content: task }] },
      {
        configurable: { thread_id: tid },
        context: this.buildContext(interfaceMode, tid),
      },
    );
    return this.toTaskResult(result);
  }

  /**
   * Stream a task with real-time events.
   * Yields streaming chunks and emits events.
   */
  async *stream(
    task: string,
    threadId?: string,
    interfaceMode: "repl" | "http" | "api" = "api",
  ): AsyncGenerator<{ agent: string; content: string }> {
    const agent = this.ensureAgent();
    const tid = threadId ?? this.newThread();

    const stream = await agent.stream(
      { messages: [{ role: "user", content: task }] },
      {
        configurable: { thread_id: tid },
        context: this.buildContext(interfaceMode, tid),
        streamMode: "messages",
        subgraphs: true,
      },
    );

    let currentAgent = "atehna";

    for await (const chunk of stream) {
      // With subgraphs: true, chunks are [namespace, [message, metadata]]
      // namespace is an array of strings representing the subgraph path
      let namespace: unknown[] = [];
      let messageData: unknown = chunk;

      if (Array.isArray(chunk) && chunk.length === 2) {
        namespace = Array.isArray(chunk[0]) ? chunk[0] : [];
        messageData = chunk[1];
      }

      // Detect agent switches from namespace
      const agentName =
        namespace.length > 0
          ? String(namespace[namespace.length - 1])
          : "atehna";

      if (agentName !== currentAgent) {
        this.emit("agent_switch", { from: currentAgent, to: agentName });
        currentAgent = agentName;
      }

      // messageData is [message, metadata] tuple in messages mode
      const message = Array.isArray(messageData) ? messageData[0] : messageData;

      // Extract text content — LangChain messages have content in various places
      const content = extractContent(message);
      if (content) {
        const tokenEvent = { agent: currentAgent, content };
        this.emit("token", tokenEvent);
        yield tokenEvent;
      }
    }
  }

  /**
   * Resume after a HITL interrupt.
   * Sends the user's decision back to the paused agent.
   */
  async resume(
    threadId: string,
    decision: HitlDecision,
    interfaceMode: "repl" | "http" | "api" = "api",
  ): Promise<TaskResult> {
    const agent = this.ensureAgent();

    const result = await agent.invoke(new Command({ resume: decision }), {
      configurable: { thread_id: threadId },
      context: this.buildContext(interfaceMode, threadId),
    });
    return this.toTaskResult(result);
  }

  /**
   * Get the current state of a thread.
   * Useful for inspecting agent progress, todos, etc.
   */
  async getState(threadId: string) {
    const agent = this.ensureAgent();
    return await agent.getState({ configurable: { thread_id: threadId } });
  }

  /**
   * Switch to a different provider/model at runtime.
   * Requires re-creating the agent.
   */
  async switchProvider(
    provider: AtehnaConfig["provider"],
    apiKey: string,
    model?: string,
  ): Promise<void> {
    this.config = {
      ...this.config,
      provider,
      apiKey,
      model:
        model ?? getModelString({ ...this.config, provider } as AtehnaConfig),
    };

    // Re-create agent with new config and clean resources
    await this.create();
  }

  /**
   * Clean shutdown — stop PinchTab, release resources.
   */
  async shutdown(): Promise<void> {
    await stopPinchTab();
    this.agent = null;
    this.currentThreadId = null;
  }

  /** Get or create a thread ID */
  newThread(): string {
    this.currentThreadId = randomUUID();
    return this.currentThreadId;
  }

  /** Get the current thread ID */
  getThreadId(): string | null {
    return this.currentThreadId;
  }

  private ensureAgent(): AtehnaAgent {
    if (!this.agent) {
      throw new Error("Agent not initialized. Call api.create() first.");
    }
    return this.agent;
  }

  private buildContext(
    interfaceMode: "repl" | "http" | "api",
    threadId: string,
  ) {
    return {
      interfaceMode,
      trustLevel: this.config.trustLevel,
      provider: this.config.provider,
      model: this.config.model,
      threadId,
    };
  }

  private toTaskResult(result: unknown): TaskResult {
    const response = result as {
      messages?: Array<{ content: unknown }>;
      structuredResponse?: {
        success?: boolean;
        summary?: string;
        files?: string[];
        blockers?: string[];
        nextSteps?: string[];
      };
      structured_response?: {
        success?: boolean;
        summary?: string;
        files?: string[];
        blockers?: string[];
        nextSteps?: string[];
      };
    };

    const structured =
      response.structuredResponse ?? response.structured_response;
    if (structured?.summary) {
      const files = Array.from(
        new Set([
          ...(structured.files ?? []),
          ...extractWorkspaceFiles(structured.summary),
        ]),
      );
      const tail = [
        structured.blockers?.length
          ? `Blockers: ${structured.blockers.join("; ")}`
          : "",
        structured.nextSteps?.length
          ? `Next steps: ${structured.nextSteps.join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        success: structured.success ?? true,
        message: tail ? `${structured.summary}\n${tail}` : structured.summary,
        files,
      };
    }

    const lastMessage = response.messages?.[response.messages.length - 1];
    const content =
      typeof lastMessage?.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? "");

    return {
      success: true,
      message: content,
      files: extractWorkspaceFiles(content),
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────

/** Extract text content from a LangChain message object */
function extractContent(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";

  const m = msg as Record<string, unknown>;

  // Direct content property (AIMessageChunk, HumanMessage, etc.)
  if (typeof m.content === "string" && m.content) return m.content;

  // Content as array of blocks (multi-modal messages)
  if (Array.isArray(m.content)) {
    return m.content
      .map((block: unknown) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return (block as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  // kwargs.content (serialized message format)
  if (m.kwargs && typeof m.kwargs === "object") {
    const kwargs = m.kwargs as Record<string, unknown>;
    if (typeof kwargs.content === "string" && kwargs.content)
      return kwargs.content;
  }

  return "";
}
