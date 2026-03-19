const WORKSPACE_FILE_PATTERN = /\/workspace\/[A-Za-z0-9._\-/]+/g;

export function extractWorkspaceFiles(text: string): string[] {
  const matches = text.match(WORKSPACE_FILE_PATTERN) ?? [];
  return Array.from(new Set(matches));
}
