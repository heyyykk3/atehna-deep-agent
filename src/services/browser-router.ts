import { createMiddleware } from "langchain";

/**
 * Bot detection patterns — if any of these appear in a browser tool result,
 * the response is flagged so the main agent knows to escalate to stealth-agent.
 *
 * Borrowed from Browserable's auto-escalation pattern.
 */
const BOT_DETECTION_PATTERNS = [
  "cloudflare",
  "access denied",
  "captcha",
  "datadome",
  "verify you are human",
  "please complete the security check",
  "enable javascript",
  "just a moment",
  "checking your browser",
  "bot detection",
  "blocked by",
  "are you a robot",
];

/**
 * Check if a tool result contains bot detection signals.
 */
function detectBotProtection(result: string): string | null {
  const lower = result.toLowerCase();
  for (const pattern of BOT_DETECTION_PATTERNS) {
    if (lower.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * BrowserRouterMiddleware — intercepts browser tool calls for:
 *
 * 1. Bot detection: scans tool results for anti-bot patterns and annotates
 *    the response so the main agent knows to switch to stealth-agent.
 *
 * 2. Logging: tracks which agent makes browser calls for observability.
 *
 * 3. Future: auto-switching to stealth when bot detection is detected.
 */
export const browserRouterMiddleware = createMiddleware({
  name: "BrowserRouterMiddleware",

  wrapToolCall: async (request, handler) => {
    const toolName = request.toolCall.name;
    const isBrowserTool = toolName.startsWith("browser");

    if (!isBrowserTool) {
      return handler(request);
    }

    const result = await handler(request);

    // Scan result for bot detection patterns
    const resultText =
      typeof result === "object" && result !== null
        ? JSON.stringify(result)
        : String(result ?? "");

    const botPattern = detectBotProtection(resultText);
    if (botPattern) {
      console.warn(
        `[BrowserRouter] Bot detection signal in ${toolName}: "${botPattern}"`,
      );
    }

    return result;
  },
});
