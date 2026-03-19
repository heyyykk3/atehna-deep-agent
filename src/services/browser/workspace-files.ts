import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WORKSPACE_ROOT = resolve(process.cwd(), "agent-workspace");

function resolveWorkspacePath(virtualPath: string): string {
  if (!virtualPath.startsWith("/workspace/")) {
    throw new Error(`Path must be under /workspace/: ${virtualPath}`);
  }

  const relative = virtualPath.slice("/workspace/".length);
  const resolved = resolve(WORKSPACE_ROOT, relative);

  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new Error(`Path escapes workspace root: ${virtualPath}`);
  }

  return resolved;
}

export async function writeWorkspaceFile(
  virtualPath: string,
  data: Buffer | Uint8Array | string
): Promise<string> {
  const target = resolveWorkspacePath(virtualPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  return virtualPath;
}
