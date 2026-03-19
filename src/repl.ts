import * as readline from "node:readline";
import { AgentAPI } from "./api.js";

// ── ANSI Colors ──────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

// ── REPL ─────────────────────────────────────────────────────

export async function startRepl(api: AgentAPI): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () =>
    new Promise<string>((resolve) => {
      rl.question(bold("\natehna> "), (answer) => resolve(answer.trim()));
    });

  console.log(bold("\n  Atehna — Browser Automation Agent"));
  console.log(dim("  Type a task, or /help for commands. Ctrl+C to exit.\n"));

  const config = api.getConfig();
  console.log(dim(`  Provider: ${config.provider} | Model: ${config.model}`));
  console.log(
    dim(`  Trust: ${config.trustLevel} | PinchTab: :${config.pinchtabPort}\n`),
  );

  while (true) {
    const input = await prompt();
    if (!input) continue;

    // ── Commands ──────────────────────────────────────
    if (input.startsWith("/")) {
      const handled = handleCommand(input, api);
      if (handled === "exit") break;
      continue;
    }

    // ── Run task ─────────────────────────────────────
    await runTask(api, input);
  }

  rl.close();
}

function handleCommand(input: string, api: AgentAPI): string | void {
  const [cmd, ...args] = input.split(" ");

  switch (cmd) {
    case "/help":
      console.log(`
${bold("Commands:")}
  /help              Show this help
  /config            Show current config
  /thread            Show current thread ID
  /new               Start a new thread
  /exit              Exit the REPL
`);
      return;

    case "/config":
      console.log(api.getConfig());
      return;

    case "/thread":
      console.log(api.getThreadId() ?? dim("(no thread)"));
      return;

    case "/new":
      api.newThread();
      console.log(green("New thread started."));
      return;

    case "/exit":
    case "/quit":
    case "/q":
      return "exit";

    default:
      console.log(yellow(`Unknown command: ${cmd}. Try /help`));
      return;
  }
}

async function runTask(api: AgentAPI, task: string): Promise<void> {
  const threadId = api.getThreadId() ?? api.newThread();
  let currentAgent = "";

  try {
    for await (const event of api.stream(task, threadId, "repl")) {
      // Show agent name when it changes
      if (event.agent !== currentAgent) {
        currentAgent = event.agent;
        process.stdout.write(`\n${cyan(`[${currentAgent}]`)} `);
      }

      // Stream token
      process.stdout.write(event.content);
    }
    process.stdout.write("\n");
  } catch (err: unknown) {
    // Check for HITL interrupt
    if (isInterruptError(err)) {
      await handleHitlInterrupt(api, err, threadId);
      return;
    }

    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`\nError: ${msg}`));
  }
}

// ── HITL Handling ────────────────────────────────────────────

function isInterruptError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "GraphInterrupt";
}

async function handleHitlInterrupt(
  api: AgentAPI,
  err: unknown,
  threadId: string,
): Promise<void> {
  // Extract interrupt info from the error
  const interrupts = (err as { interrupts?: Array<{ value: unknown }> })
    .interrupts;
  if (!interrupts || interrupts.length === 0) {
    console.error(red("HITL interrupt but no interrupt data found."));
    return;
  }

  for (const interrupt of interrupts) {
    const value = interrupt.value as {
      kind?: "approval" | "question";
      tool?: string;
      args?: Record<string, unknown>;
      description?: string;
      question?: string;
    };

    if (value.kind === "question" && value.question) {
      console.log(yellow(`\n? User Input Required`));
      console.log(`  ${value.question}`);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(bold("  Answer: "), (a) => {
          rl.close();
          resolve(a.trim());
        });
      });

      try {
        const result = await api.resume(threadId, answer, "repl");
        console.log(`\n${result.message}`);
      } catch (resumeErr: unknown) {
        if (isInterruptError(resumeErr)) {
          await handleHitlInterrupt(api, resumeErr, threadId);
        } else {
          const msg =
            resumeErr instanceof Error ? resumeErr.message : String(resumeErr);
          console.error(red(`Resume error: ${msg}`));
        }
      }
      continue;
    }

    console.log(yellow(`\n⚠ HITL Approval Required`));

    if (value.tool) {
      console.log(`  Tool: ${bold(value.tool)}`);
    }
    if (value.args) {
      console.log(`  Args: ${JSON.stringify(value.args, null, 2)}`);
    }
    if (value.description) {
      console.log(`  ${value.description}`);
    }

    console.log(dim("\n  [a]pprove  [e]dit  [r]eject"));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(bold("  Decision: "), (a) => {
        rl.close();
        resolve(a.trim().toLowerCase());
      });
    });

    let decision:
      | { type: "approve" }
      | { type: "edit"; args: Record<string, unknown> }
      | { type: "reject" };

    switch (answer[0]) {
      case "a":
        decision = { type: "approve" };
        console.log(green("  Approved."));
        break;

      case "e": {
        // Simple edit: ask for new args as JSON
        const editRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const newArgs = await new Promise<string>((resolve) => {
          editRl.question("  New args (JSON): ", (a) => {
            editRl.close();
            resolve(a.trim());
          });
        });
        try {
          decision = { type: "edit", args: JSON.parse(newArgs) };
          console.log(green("  Edited."));
        } catch {
          console.log(red("  Invalid JSON. Rejecting."));
          decision = { type: "reject" };
        }
        break;
      }

      default:
        decision = { type: "reject" };
        console.log(red("  Rejected."));
        break;
    }

    // Resume the agent with the decision
    try {
      const result = await api.resume(threadId, decision, "repl");
      console.log(`\n${result.message}`);
    } catch (resumeErr: unknown) {
      // May be another interrupt — recurse
      if (isInterruptError(resumeErr)) {
        await handleHitlInterrupt(api, resumeErr, threadId);
      } else {
        const msg =
          resumeErr instanceof Error ? resumeErr.message : String(resumeErr);
        console.error(red(`Resume error: ${msg}`));
      }
    }
  }
}
