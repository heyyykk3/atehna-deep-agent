import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join, resolve } from "node:path";
import { AgentAPI } from "./api.js";
import { TaskManager } from "./services/task-manager.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

function sendSseEvent(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sanitizeWorkspacePath(filePath: string): string {
  const workspaceRoot = resolve(process.cwd(), "agent-workspace");
  const relative = filePath.replace(/^\/workspace\//, "");
  const absolute = resolve(workspaceRoot, relative);

  if (absolute !== workspaceRoot && !absolute.startsWith(`${workspaceRoot}/`)) {
    throw new Error("Invalid workspace path.");
  }

  return absolute;
}

function mimeTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".txt":
    case ".md":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export async function startHttpServer(
  api: AgentAPI,
  options?: { port?: number },
): Promise<{ close: () => Promise<void>; port: number }> {
  const taskManager = new TaskManager(api);
  const port = options?.port ?? Number(process.env.ATEHNA_HTTP_PORT || 8787);

  const server = createServer(async (req, res) => {
    try {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", "http://localhost");
      const path = url.pathname;

      if (method === "GET" && path === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === "POST" && path === "/api/tasks") {
        const body = (await readJsonBody(req)) as { task?: string };
        if (!body.task?.trim()) {
          sendJson(res, 400, { error: "Body must include non-empty `task`." });
          return;
        }
        const task = await taskManager.createTask(body.task.trim());
        sendJson(res, 202, task);
        return;
      }

      if (method === "GET" && path === "/api/tasks") {
        sendJson(res, 200, taskManager.listTasks());
        return;
      }

      const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
      if (method === "GET" && taskMatch) {
        const task = taskManager.getTask(taskMatch[1]);
        if (!task) {
          sendJson(res, 404, { error: "Task not found." });
          return;
        }
        sendJson(res, 200, task);
        return;
      }

      const approveMatch = path.match(/^\/api\/tasks\/([^/]+)\/approve$/);
      if (method === "POST" && approveMatch) {
        const body = await readJsonBody(req);
        const task = await taskManager.submitDecision(
          approveMatch[1],
          body as never,
        );
        sendJson(res, 200, task);
        return;
      }

      const eventsMatch = path.match(/^\/api\/tasks\/([^/]+)\/events$/);
      if (method === "GET" && eventsMatch) {
        const task = taskManager.getTask(eventsMatch[1]);
        if (!task) {
          sendJson(res, 404, { error: "Task not found." });
          return;
        }

        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream",
        });

        sendSseEvent(res, {
          type: "task_updated",
          taskId: task.id,
          ts: new Date().toISOString(),
          data: {
            status: task.status,
            output: task.output,
            files: task.files,
            pendingInterrupts: task.pendingInterrupts,
          },
        });

        const unsubscribe = taskManager.subscribe(task.id, (event) => {
          sendSseEvent(res, event);
        });

        req.on("close", () => {
          unsubscribe();
          res.end();
        });
        return;
      }

      const logsMatch = path.match(/^\/api\/tasks\/([^/]+)\/logs$/);
      if (method === "GET" && logsMatch) {
        const logPath = taskManager.getLogPath(logsMatch[1]);
        await access(logPath);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        createReadStream(logPath).pipe(res);
        return;
      }

      const filesMatch = path.match(/^\/api\/tasks\/([^/]+)\/files$/);
      if (method === "GET" && filesMatch) {
        const task = taskManager.getTask(filesMatch[1]);
        if (!task) {
          sendJson(res, 404, { error: "Task not found." });
          return;
        }
        sendJson(res, 200, { files: task.files });
        return;
      }

      const fileDownloadMatch = path.match(
        /^\/api\/tasks\/([^/]+)\/files\/(.+)$/,
      );
      if (method === "GET" && fileDownloadMatch) {
        const task = taskManager.getTask(fileDownloadMatch[1]);
        if (!task) {
          sendJson(res, 404, { error: "Task not found." });
          return;
        }

        const virtualPath = `/workspace/${fileDownloadMatch[2]}`;
        if (!task.files.includes(virtualPath)) {
          sendJson(res, 404, { error: "File not recorded for this task." });
          return;
        }

        const absolutePath = sanitizeWorkspacePath(virtualPath);
        await access(absolutePath);
        res.statusCode = 200;
        res.setHeader("Content-Type", mimeTypeFor(absolutePath));
        createReadStream(absolutePath).pipe(res);
        return;
      }

      sendJson(res, 404, { error: "Not found." });
    } catch (err: unknown) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(port, () => resolvePromise());
  });

  return {
    port,
    close: async () => {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolvePromise();
        });
      });
    },
  };
}
