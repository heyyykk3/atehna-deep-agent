import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PinchTabMode } from "../types.js";

const RUNTIME_ROOT = join(process.cwd(), "agent-runtime");
const MEMORY_ROOT = join(process.cwd(), "agent-memory");
const WORKSPACE_ROOT = join(process.cwd(), "agent-workspace");

const SOURCE_AGENTS = join(process.cwd(), "src", "AGENTS.md");
const SOURCE_SKILLS = join(process.cwd(), "src", "skills");

export interface RuntimePaths {
  runtimeRoot: string;
  memoryRoot: string;
  workspaceRoot: string;
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function copyFileIfChanged(
  source: string,
  target: string,
): Promise<void> {
  const content = await readFile(source, "utf8");
  await ensureDir(dirname(target));

  let existing: string | null = null;
  try {
    existing = await readFile(target, "utf8");
  } catch {
    existing = null;
  }

  if (existing !== content) {
    await writeFile(target, content, "utf8");
  }
}

async function syncDir(source: string, target: string): Promise<void> {
  await ensureDir(target);
  const entries = await readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);

    if (entry.isDirectory()) {
      await syncDir(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      await copyFileIfChanged(sourcePath, targetPath);
    }
  }
}

async function ensureMemoryFile(
  fileName: string,
  initialContent: string,
): Promise<void> {
  const path = join(MEMORY_ROOT, fileName);
  try {
    await stat(path);
  } catch {
    await writeFile(path, initialContent, "utf8");
  }
}

export async function ensureRuntimeFiles(): Promise<RuntimePaths> {
  await ensureDir(RUNTIME_ROOT);
  await ensureDir(MEMORY_ROOT);
  await ensureDir(WORKSPACE_ROOT);

  await syncDir(SOURCE_SKILLS, join(RUNTIME_ROOT, "skills"));
  await copyFileIfChanged(SOURCE_AGENTS, join(RUNTIME_ROOT, "AGENTS.md"));

  await Promise.all([
    ensureDir(join(WORKSPACE_ROOT, "uploads")),
    ensureDir(join(WORKSPACE_ROOT, "screenshots")),
    ensureDir(join(WORKSPACE_ROOT, "downloads")),
    ensureDir(join(WORKSPACE_ROOT, "research")),
  ]);

  await Promise.all([
    ensureMemoryFile("site-patterns.md", "# Site Patterns\n\n"),
    ensureMemoryFile("form-mappings.md", "# Form Mappings\n\n"),
    ensureMemoryFile("failed-approaches.md", "# Failed Approaches\n\n"),
    ensureMemoryFile("user-corrections.md", "# User Corrections\n\n"),
  ]);

  return {
    runtimeRoot: RUNTIME_ROOT,
    memoryRoot: MEMORY_ROOT,
    workspaceRoot: WORKSPACE_ROOT,
  };
}

export async function ensurePinchTabServerConfig(options: {
  port: number;
  mode: PinchTabMode;
  token: string;
}): Promise<string> {
  const { runtimeRoot } = await ensureRuntimeFiles();
  const configDir = join(runtimeRoot, "pinchtab");
  const configPath = join(configDir, "config.json");
  const stateDir = join(configDir, "state");
  const profilesDir = join(configDir, "profiles");

  await ensureDir(configDir);
  await ensureDir(stateDir);
  await ensureDir(profilesDir);

  const config = {
    configVersion: "0.8.0",
    server: {
      bind: "127.0.0.1",
      port: String(options.port),
      token: options.token,
      stateDir,
    },
    instanceDefaults: {
      mode: options.mode,
    },
    profiles: {
      baseDir: profilesDir,
      defaultProfile: "default",
    },
    multiInstance: {
      strategy: "simple",
      allocationPolicy: "fcfs",
      instancePortStart: options.port + 1,
      instancePortEnd: options.port + 100,
    },
    security: {
      allowEvaluate: true,
      allowDownload: true,
      allowUpload: true,
      attach: {
        enabled: false,
        allowHosts: ["127.0.0.1", "localhost", "::1"],
        allowSchemes: ["ws", "wss"],
      },
      idpi: {
        enabled: true,
        allowedDomains: ["*"],
        strictMode: false,
        scanContent: true,
        wrapContent: true,
        customPatterns: [],
      },
    },
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}
