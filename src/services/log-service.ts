import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOG_ROOT = join(process.cwd(), "agent-runtime", "logs");

export interface TaskLogEntry {
  ts: string;
  taskId: string;
  type:
    | "task_started"
    | "token"
    | "interrupt"
    | "decision"
    | "completed"
    | "error";
  data: Record<string, unknown>;
}

export class LogService {
  private async ensureRoot(): Promise<void> {
    await mkdir(LOG_ROOT, { recursive: true });
  }

  async append(taskId: string, entry: Omit<TaskLogEntry, "ts" | "taskId">): Promise<void> {
    await this.ensureRoot();
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      taskId,
      ...entry,
    });
    await appendFile(join(LOG_ROOT, `${taskId}.jsonl`), `${line}\n`, "utf8");
  }

  getTaskLogPath(taskId: string): string {
    return join(LOG_ROOT, `${taskId}.jsonl`);
  }
}
