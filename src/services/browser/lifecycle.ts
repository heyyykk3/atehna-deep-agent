import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { PinchTabMode } from "../../types.js";
import { ensurePinchTabServerConfig } from "../runtime-files.js";
import { PinchTabClient } from "./pinchtab-client.js";

interface LifecycleConfig {
  port: number;
  autoStart: boolean;
  mode: PinchTabMode;
  configPath?: string;
  token?: string;
  binaryPath: string;
  healthCheckTimeout: number; // ms to wait for PinchTab to become ready
  healthCheckInterval: number; // ms between health check polls
}

const DEFAULT_CONFIG: LifecycleConfig = {
  port: 9867,
  autoStart: true,
  mode: "headless",
  binaryPath: "npx",
  healthCheckTimeout: 30_000,
  healthCheckInterval: 500,
};

let pinchtabProcess: ChildProcess | null = null;
let client: PinchTabClient | null = null;

/**
 * Get the shared PinchTabClient instance.
 * Creates one if it doesn't exist.
 */
export function getClient(config?: {
  port?: number;
  token?: string;
}): PinchTabClient {
  if (!client) {
    client = new PinchTabClient({
      baseUrl: `http://localhost:${config?.port || DEFAULT_CONFIG.port}`,
      token: config?.token,
    });
  }
  return client;
}

/**
 * Wait for PinchTab to respond to health checks.
 */
async function waitForHealthy(
  client: PinchTabClient,
  timeout: number,
  interval: number,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await client.healthCheck()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

async function ensureInstanceMode(
  client: PinchTabClient,
  mode: PinchTabMode,
): Promise<void> {
  const isMatchingMode = (headless: boolean) =>
    mode === "headed" ? !headless : headless;

  const readInstances = async () => client.instances().catch(() => []);
  let instances = await readInstances();
  let running = instances.filter((instance) => instance.status === "running");

  if (running.length === 0) {
    await client.startInstance({ mode });
    const deadline = Date.now() + DEFAULT_CONFIG.healthCheckTimeout;
    while (Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, DEFAULT_CONFIG.healthCheckInterval),
      );
      instances = await readInstances();
      running = instances.filter((instance) => instance.status === "running");
      const ready = running.find((instance) =>
        isMatchingMode(instance.headless),
      );
      if (ready) {
        client.setDefaultInstanceId(ready.id);
        return;
      }
    }

    throw new Error(
      `PinchTab started an instance in ${mode} mode, but it never reached running state.`,
    );
  }

  const matching = running.filter((instance) =>
    isMatchingMode(instance.headless),
  );

  if (matching.length === running.length) {
    client.setDefaultInstanceId(matching[0]?.id ?? null);
    return;
  }

  if (matching.length > 0) {
    client.setDefaultInstanceId(matching[0].id);
    console.warn(
      `PinchTab: found a mix of headed/headless instances; continuing with at least one ${mode} instance available.`,
    );
    return;
  }

  throw new Error(
    `PinchTab is running, but only ${mode === "headed" ? "headless" : "headed"} instances are active. ` +
      `Stop the conflicting instances or start Atehna with a dedicated PinchTab server.`,
  );
}

/**
 * Start or connect to PinchTab.
 *
 * - If PinchTab is already running: connect to it
 * - If not and autoStart=true: spawn the process, wait for health
 * - If not and autoStart=false: throw
 */
export async function startPinchTab(
  config?: Partial<LifecycleConfig>,
): Promise<PinchTabClient> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const token = cfg.token || process.env.PINCHTAB_TOKEN;
  const ptClient = getClient({ port: cfg.port, token });

  // Check if already running
  if (await ptClient.healthCheck()) {
    console.log(`PinchTab: connected on :${cfg.port}`);
    await ensureInstanceMode(ptClient, cfg.mode);
    return ptClient;
  }

  if (!cfg.autoStart) {
    throw new Error(
      `PinchTab not running on :${cfg.port} and auto-start is disabled.\n` +
        `Start PinchTab manually with a config that listens on ${cfg.port}: pinchtab server`,
    );
  }

  // Spawn PinchTab process
  console.log(`PinchTab: starting on :${cfg.port}...`);
  const resolvedToken = token || `atehna-${randomUUID()}`;
  const resolvedConfigPath =
    cfg.configPath ||
    (await ensurePinchTabServerConfig({
      port: cfg.port,
      mode: cfg.mode,
      token: resolvedToken,
    }));

  const spawnedClient = new PinchTabClient({
    baseUrl: `http://localhost:${cfg.port}`,
    token: resolvedToken,
  });
  client = spawnedClient;

  pinchtabProcess = spawn(cfg.binaryPath, ["pinchtab", "server"], {
    env: {
      ...process.env,
      PINCHTAB_CONFIG: resolvedConfigPath,
      PINCHTAB_TOKEN: resolvedToken,
    },
    stdio: "pipe",
    detached: false,
  });

  // Log stderr for debugging
  pinchtabProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`PinchTab: ${msg}`);
  });

  pinchtabProcess.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        `PinchTab binary not found at "${cfg.binaryPath}".\n` +
          `Install: npm install pinchtab`,
      );
    } else {
      console.error(`PinchTab process error: ${err.message}`);
    }
    pinchtabProcess = null;
  });

  pinchtabProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`PinchTab exited with code ${code}`);
    }
    pinchtabProcess = null;
  });

  // Wait for health
  const healthy = await waitForHealthy(
    spawnedClient,
    cfg.healthCheckTimeout,
    cfg.healthCheckInterval,
  );

  if (!healthy) {
    await stopPinchTab();
    throw new Error(
      `PinchTab failed to start within ${cfg.healthCheckTimeout}ms.\n` +
        `Check that "${cfg.binaryPath}" is installed and port ${cfg.port} is free.`,
    );
  }

  await ensureInstanceMode(spawnedClient, cfg.mode);
  console.log(`PinchTab: ready on :${cfg.port}`);
  return spawnedClient;
}

/**
 * Stop the PinchTab process if we spawned it.
 * Does nothing if we connected to an existing instance.
 */
export async function stopPinchTab(): Promise<void> {
  if (pinchtabProcess) {
    console.log("PinchTab: shutting down...");
    pinchtabProcess.kill("SIGTERM");

    // Give it 5s to exit gracefully, then force kill
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (pinchtabProcess) {
          pinchtabProcess.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      pinchtabProcess!.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    pinchtabProcess = null;
  }
  client = null;
}

/**
 * Check if PinchTab is currently healthy.
 */
export async function isPinchTabHealthy(): Promise<boolean> {
  if (!client) return false;
  return client.healthCheck();
}

/**
 * Attempt to reconnect to PinchTab after a connection loss.
 * If we spawned the process and it died, restart it.
 */
export async function reconnectPinchTab(
  config?: Partial<LifecycleConfig>,
): Promise<PinchTabClient> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // If our spawned process died, restart
  if (pinchtabProcess === null && cfg.autoStart) {
    return startPinchTab(cfg);
  }

  // Otherwise just wait for existing instance to come back
  const ptClient = getClient({ port: cfg.port, token: cfg.token });
  const healthy = await waitForHealthy(
    ptClient,
    cfg.healthCheckTimeout,
    cfg.healthCheckInterval,
  );

  if (!healthy) {
    throw new Error(`PinchTab reconnection failed on :${cfg.port}`);
  }

  await ensureInstanceMode(ptClient, cfg.mode);
  return ptClient;
}
