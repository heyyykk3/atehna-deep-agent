import type { StructuredTool } from "@langchain/core/tools";

/**
 * Load Patchright MCP tools via @langchain/mcp-adapters.
 *
 * Connects to patchright-mcp via stdio transport.
 * Returns empty array if @langchain/mcp-adapters or patchright-mcp
 * is not installed (stealth-agent will be unavailable).
 */
export async function loadPatchrightMcpTools(): Promise<StructuredTool[]> {
  try {
    // Dynamic import — fails gracefully if not installed
    // @ts-expect-error — package may not be installed yet (Phase 8)
    const { MultiServerMCPClient } = await import("@langchain/mcp-adapters");

    const mcpClient = new MultiServerMCPClient({
      patchright: {
        transport: "stdio" as const,
        command: "npx",
        args: ["-y", "patchright-mcp"],
      },
    });

    const tools = await mcpClient.getTools();
    console.log(
      `Patchright MCP: loaded ${tools.length} tools (stealth-agent ready)`
    );
    return tools as StructuredTool[];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("Cannot find") || msg.includes("MODULE_NOT_FOUND")) {
      console.log(
        "Patchright MCP: not available (install @langchain/mcp-adapters and patchright-mcp for stealth browsing)"
      );
    } else {
      console.warn(`Patchright MCP: failed to load — ${msg}`);
    }

    return [];
  }
}

/**
 * Load additional MCP tools from user-configured .mcp.json files.
 *
 * Auto-discovery order:
 * 1. ~/.atehna/.mcp.json (user-level)
 * 2. <project>/.mcp.json (project-level)
 *
 * Returns empty array if no configs found or @langchain/mcp-adapters not installed.
 */
export async function loadUserMcpTools(): Promise<StructuredTool[]> {
  // Future: discover and load user MCP configs
  // For now, returns empty — only patchright-mcp is supported
  return [];
}
