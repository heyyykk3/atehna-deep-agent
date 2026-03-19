import { randomUUID } from "node:crypto";
import type { AgentAPI } from "../api.js";
import type { HitlDecision, TaskResult } from "../types.js";
import { extractWorkspaceFiles } from "./file-tracker.js";
import { LogService } from "./log-service.js";

export type ManagedTaskStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "completed"
  | "failed";

export interface PendingInterrupt {
  kind?: "approval" | "question";
  tool?: string;
  args?: Record<string, unknown>;
  description?: string;
  question?: string;
}

export interface ManagedTask {
  id: string;
  threadId: string;
  input: string;
  status: ManagedTaskStatus;
  output: string;
  files: string[];
  error?: string;
  pendingInterrupts: PendingInterrupt[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  type:
    | "task_started"
    | "task_updated"
    | "token"
    | "interrupt"
    | "completed"
    | "error";
  taskId: string;
  ts: string;
  data: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseInterrupts(err: unknown): PendingInterrupt[] {
  const interrupts = (err as { interrupts?: Array<{ value: unknown }> })
    .interrupts;
  if (!interrupts?.length) return [];

  return interrupts.map((interrupt) => {
    const value = interrupt.value as PendingInterrupt;
    return {
      kind: value.kind,
      tool: value.tool,
      args: value.args,
      description: value.description,
      question: value.question,
    };
  });
}

function isInterruptError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { name?: string }).name === "GraphInterrupt"
  );
}

export class TaskManager {
  private readonly api: AgentAPI;
  private readonly tasks = new Map<string, ManagedTask>();
  private readonly logs = new LogService();
  private readonly subscribers = new Map<
    string,
    Set<(event: TaskEvent) => void>
  >();

  constructor(api: AgentAPI) {
    this.api = api;
  }

  listTasks(): ManagedTask[] {
    return Array.from(this.tasks.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  getTask(taskId: string): ManagedTask | undefined {
    return this.tasks.get(taskId);
  }

  getLogPath(taskId: string): string {
    return this.logs.getTaskLogPath(taskId);
  }

  async createTask(input: string): Promise<ManagedTask> {
    const id = randomUUID();
    const threadId = randomUUID();
    const task: ManagedTask = {
      id,
      threadId,
      input,
      status: "queued",
      output: "",
      files: [],
      pendingInterrupts: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.tasks.set(id, task);
    this.emitEvent({
      type: "task_started",
      taskId: id,
      ts: nowIso(),
      data: { input, threadId },
    });
    await this.logs.append(id, {
      type: "task_started",
      data: { input, threadId },
    });

    void this.runTask(task);
    return task;
  }

  async submitDecision(
    taskId: string,
    decision: HitlDecision,
  ): Promise<ManagedTask> {
    const task = this.requireTask(taskId);
    if (task.status !== "waiting_for_input") {
      throw new Error(`Task ${taskId} is not waiting for input.`);
    }

    task.updatedAt = nowIso();
    await this.logs.append(taskId, {
      type: "decision",
      data: { decision },
    });
    this.emitEvent({
      type: "task_updated",
      taskId,
      ts: nowIso(),
      data: { status: "running", decision },
    });

    try {
      const result = await this.api.resume(task.threadId, decision, "http");
      this.applyResult(task, result);
    } catch (err: unknown) {
      if (isInterruptError(err)) {
        task.status = "waiting_for_input";
        task.pendingInterrupts = parseInterrupts(err);
        task.updatedAt = nowIso();
        await this.logs.append(taskId, {
          type: "interrupt",
          data: { interrupts: task.pendingInterrupts },
        });
        this.emitEvent({
          type: "interrupt",
          taskId,
          ts: nowIso(),
          data: { interrupts: task.pendingInterrupts },
        });
        return task;
      }

      task.status = "failed";
      task.error = err instanceof Error ? err.message : String(err);
      task.updatedAt = nowIso();
      await this.logs.append(taskId, {
        type: "error",
        data: { error: task.error },
      });
      this.emitEvent({
        type: "error",
        taskId,
        ts: nowIso(),
        data: { error: task.error },
      });
      throw err;
    }

    return task;
  }

  private async runTask(task: ManagedTask): Promise<void> {
    task.status = "running";
    task.updatedAt = nowIso();
    this.emitEvent({
      type: "task_updated",
      taskId: task.id,
      ts: task.updatedAt,
      data: { status: task.status },
    });

    try {
      for await (const event of this.api.stream(
        task.input,
        task.threadId,
        "http",
      )) {
        task.output += event.content;
        for (const file of extractWorkspaceFiles(event.content)) {
          if (!task.files.includes(file)) task.files.push(file);
        }
        task.updatedAt = nowIso();
        await this.logs.append(task.id, {
          type: "token",
          data: event,
        });
        this.emitEvent({
          type: "token",
          taskId: task.id,
          ts: nowIso(),
          data: event,
        });
      }

      task.status = "completed";
      task.updatedAt = nowIso();
      await this.logs.append(task.id, {
        type: "completed",
        data: { output: task.output, files: task.files },
      });
      this.emitEvent({
        type: "completed",
        taskId: task.id,
        ts: task.updatedAt,
        data: { output: task.output, files: task.files },
      });
    } catch (err: unknown) {
      if (isInterruptError(err)) {
        task.status = "waiting_for_input";
        task.pendingInterrupts = parseInterrupts(err);
        task.updatedAt = nowIso();
        await this.logs.append(task.id, {
          type: "interrupt",
          data: { interrupts: task.pendingInterrupts },
        });
        this.emitEvent({
          type: "interrupt",
          taskId: task.id,
          ts: task.updatedAt,
          data: { interrupts: task.pendingInterrupts },
        });
        return;
      }

      task.status = "failed";
      task.error = err instanceof Error ? err.message : String(err);
      task.updatedAt = nowIso();
      await this.logs.append(task.id, {
        type: "error",
        data: { error: task.error },
      });
      this.emitEvent({
        type: "error",
        taskId: task.id,
        ts: task.updatedAt,
        data: { error: task.error },
      });
    }
  }

  private applyResult(task: ManagedTask, result: TaskResult): void {
    task.output += result.message;
    for (const file of [
      ...task.files,
      ...result.files,
      ...extractWorkspaceFiles(result.message),
    ]) {
      if (!task.files.includes(file)) task.files.push(file);
    }
    task.pendingInterrupts = [];
    task.status = "completed";
    task.updatedAt = nowIso();
    void this.logs.append(task.id, {
      type: "completed",
      data: { output: task.output, files: task.files },
    });
    this.emitEvent({
      type: "completed",
      taskId: task.id,
      ts: task.updatedAt,
      data: { output: task.output, files: task.files },
    });
  }

  subscribe(
    taskId: string,
    subscriber: (event: TaskEvent) => void,
  ): () => void {
    let subs = this.subscribers.get(taskId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(taskId, subs);
    }
    subs.add(subscriber);
    return () => {
      const existing = this.subscribers.get(taskId);
      existing?.delete(subscriber);
      if (existing && existing.size === 0) {
        this.subscribers.delete(taskId);
      }
    };
  }

  private emitEvent(event: TaskEvent): void {
    const subs = this.subscribers.get(event.taskId);
    if (!subs) return;
    for (const subscriber of subs) {
      subscriber(event);
    }
  }

  private requireTask(taskId: string): ManagedTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }
    return task;
  }
}
