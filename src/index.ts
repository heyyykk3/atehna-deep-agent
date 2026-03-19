import "dotenv/config";
import { loadConfig } from "./config/env.js";
import { validateProviderInstalled } from "./config/providers.js";
import { AgentAPI } from "./api.js";
import { startRepl } from "./repl.js";
import { startHttpServer } from "./server.js";

const shutdownHooks: Array<() => Promise<void>> = [];

async function main() {
  // 1. Load config from .env
  const config = loadConfig();
  await validateProviderInstalled(config);
  console.log(`Atehna starting — ${config.model}`);

  // 2. Create API (manages agent + browser lifecycle)
  const api = new AgentAPI(config);

  // 3. Initialize everything (PinchTab, MCP, agent)
  await api.create();

  const mode = process.argv.includes("--server") ? "server" : "repl";

  if (mode === "server") {
    const server = await startHttpServer(api);
    shutdownHooks.push(() => server.close());
    shutdownHooks.push(() => api.shutdown());
    console.log(`Atehna HTTP API listening on http://localhost:${server.port}`);
    return;
  }

  // 4. Start REPL
  await startRepl(api);

  // 5. Cleanup on exit
  await api.shutdown();
  console.log("Atehna shut down.");
}

// Handle Ctrl+C gracefully
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  for (const hook of shutdownHooks.reverse()) {
    try {
      await hook();
    } catch {
      // Best-effort shutdown
    }
  }
  process.exit(0);
});

main().catch((err) => {
  console.error("Fatal error:", err.message || err);
  process.exit(1);
});
