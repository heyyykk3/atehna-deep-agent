import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { PinchTabClient } from "./pinchtab-client.js";
import { writeWorkspaceFile } from "./workspace-files.js";

/**
 * Creates all 15 PinchTab browser tools as LangChain tools.
 * Each tool wraps a PinchTab HTTP endpoint with Zod schema validation.
 */
export function createBrowserTools(client: PinchTabClient) {
  // ── 1. Navigate ──────────────────────────────────────────

  const browserNavigate = tool(
    async ({ url, waitUntil, tabId, newTab }) => {
      // Auto-prepend https:// if no protocol specified
      const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      let resolvedTabId = tabId;

      if (!newTab && !resolvedTabId) {
        const tabs = await client.tabs().catch(() => []);
        resolvedTabId = tabs.find((tab) => tab.active)?.id || tabs[0]?.id;
      }

      const res = await client.navigate({
        url: fullUrl,
        waitUntil,
        tabId: resolvedTabId,
      });
      return `Navigated to ${res.url} ("${res.title}") [tab: ${res.tabId}]`;
    },
    {
      name: "browserNavigate",
      description:
        "Navigate the browser to a URL. By default this reuses the current tab; set newTab=true to open a fresh tab. Returns the page title and tab ID.",
      schema: z.object({
        url: z.string().describe("The URL to navigate to"),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe("When to consider navigation complete. Default: load"),
        tabId: z
          .string()
          .optional()
          .describe(
            "Tab to navigate in. Omit to reuse the current active tab.",
          ),
        newTab: z
          .boolean()
          .optional()
          .describe("Open a new tab instead of reusing the current one."),
      }),
    },
  );

  // ── 2. Snapshot ──────────────────────────────────────────

  const browserSnapshot = tool(
    async ({ tabId, filter }) => {
      const res = await client.snapshot({ tabId, filter });
      return `Page: ${res.url} ("${res.title}")\n\n${res.content}`;
    },
    {
      name: "browserSnapshot",
      description:
        "Get the accessibility tree of the current page. Returns element refs (e0, e1, ...) " +
        "that can be used with browserClick, browserFill, etc. " +
        "IMPORTANT: Use filter='interactive' to see only clickable/fillable elements (much shorter). " +
        "Use 'all' only when you need to read page content.",
      schema: z.object({
        tabId: z
          .string()
          .optional()
          .describe("Tab to snapshot. Omit for current."),
        filter: z
          .enum(["all", "interactive", "visible"])
          .optional()
          .describe(
            "Filter elements: 'all' (default), 'interactive' (clickable/fillable only), 'visible' (visible only)",
          ),
      }),
    },
  );

  // ── 3. Click ─────────────────────────────────────────────

  const browserClick = tool(
    async ({ ref, tabId, button, clickCount, purpose }) => {
      if (purpose && purpose !== "generic") {
        const decision = interrupt({
          kind: "approval",
          tool: "browserClick",
          args: { ref, tabId, button, clickCount, purpose },
          description:
            purpose === "submit"
              ? "Approval required before clicking a submit action."
              : purpose === "destructive"
                ? "Approval required before clicking a destructive action."
                : "Approval required before clicking a confirmation action.",
        }) as
          | {
              type?: "approve" | "edit" | "reject";
              args?: Record<string, unknown>;
            }
          | undefined;

        if (decision?.type === "reject") {
          return `User rejected click on [${ref}]`;
        }
      }

      const res = await client.click({ ref, tabId, button, clickCount });
      return res.success
        ? `Clicked element [${ref}]`
        : `Failed to click [${ref}]`;
    },
    {
      name: "browserClick",
      description:
        "Click an element by its ref from browserSnapshot (e.g., 'e0', 'e1'). " +
        "Always snapshot first to get current element refs.",
      schema: z.object({
        ref: z
          .string()
          .describe("Element ref from snapshot (e.g., 'e0', 'e1')"),
        tabId: z.string().optional(),
        button: z
          .enum(["left", "right", "middle"])
          .optional()
          .describe("Mouse button. Default: left"),
        clickCount: z
          .number()
          .optional()
          .describe("Number of clicks. Use 2 for double-click."),
        purpose: z
          .enum(["generic", "submit", "confirm", "destructive"])
          .optional()
          .describe(
            "Mark risky clicks so the user can approve before final submission, confirmation, or destructive actions.",
          ),
      }),
    },
  );

  // ── 4. Fill ──────────────────────────────────────────────

  const browserFill = tool(
    async ({ ref, value, tabId, fieldName }) => {
      const sensitivePatterns =
        /password|passwd|card.?number|cvv|cvc|ssn|social.?security|credit.?card|secret/i;
      if (fieldName && sensitivePatterns.test(fieldName)) {
        const decision = interrupt({
          kind: "approval",
          tool: "browserFill",
          args: { ref, value, tabId, fieldName },
          description: `Approval required before filling sensitive field "${fieldName}".`,
        }) as
          | { type?: "approve" | "edit" | "reject"; args?: { value?: string } }
          | undefined;

        if (decision?.type === "reject") {
          return `User rejected fill for [${ref}]`;
        }

        if (
          decision?.type === "edit" &&
          typeof decision.args?.value === "string"
        ) {
          value = decision.args.value;
        }
      }

      const res = await client.fill({ ref, value, tabId });
      return res.success
        ? `Filled [${ref}] with value`
        : `Failed to fill [${ref}]`;
    },
    {
      name: "browserFill",
      description:
        "Fill an input field by its ref. Clears existing value first. " +
        "For sensitive fields (password, card, CVV, SSN), HITL approval is required. " +
        "Always snapshot first to get current element refs.",
      schema: z.object({
        ref: z.string().describe("Element ref from snapshot (e.g., 'e5')"),
        value: z.string().describe("Value to fill into the field"),
        tabId: z.string().optional(),
        fieldName: z
          .string()
          .optional()
          .describe(
            "Human-readable field label or purpose from the page snapshot. Required for sensitive fields like password or card details.",
          ),
      }),
    },
  );

  // ── 4b. Focus ────────────────────────────────────────────

  const browserFocus = tool(
    async ({ ref, tabId }) => {
      const res = await client.focus({ ref, tabId });
      return res.success ? `Focused [${ref}]` : `Failed to focus [${ref}]`;
    },
    {
      name: "browserFocus",
      description:
        "Focus an input or interactive element by its ref. Use before typing into widgets that require focus but do not accept direct fill.",
      schema: z.object({
        ref: z.string().describe("Element ref from snapshot"),
        tabId: z.string().optional(),
      }),
    },
  );

  // ── 5. Type ──────────────────────────────────────────────

  const browserType = tool(
    async ({ text, tabId, delay }) => {
      const res = await client.type({ text, tabId, delay });
      return res.success ? `Typed "${text}"` : `Failed to type`;
    },
    {
      name: "browserType",
      description:
        "Type text character by character (simulates real typing). " +
        "Use this instead of browserFill when the site requires keystroke events " +
        "(e.g., autocomplete, search suggestions).",
      schema: z.object({
        text: z.string().describe("Text to type"),
        tabId: z.string().optional(),
        delay: z
          .number()
          .optional()
          .describe("Delay between keystrokes in ms. Default: 50"),
      }),
    },
  );

  // ── 6. Press ─────────────────────────────────────────────

  const browserPress = tool(
    async ({ key, tabId, modifiers }) => {
      const res = await client.press({ key, tabId, modifiers });
      return res.success ? `Pressed ${key}` : `Failed to press ${key}`;
    },
    {
      name: "browserPress",
      description:
        "Press a keyboard key. Use for Enter, Tab, Escape, arrow keys, etc. " +
        "Can combine with modifiers (Shift, Control, Alt, Meta).",
      schema: z.object({
        key: z
          .string()
          .describe(
            "Key to press: Enter, Tab, Escape, ArrowDown, ArrowUp, Backspace, Delete, etc.",
          ),
        tabId: z.string().optional(),
        modifiers: z
          .array(z.enum(["Shift", "Control", "Alt", "Meta"]))
          .optional()
          .describe("Modifier keys to hold while pressing"),
      }),
    },
  );

  // ── 7. Hover ─────────────────────────────────────────────

  const browserHover = tool(
    async ({ ref, tabId }) => {
      const res = await client.hover({ ref, tabId });
      return res.success ? `Hovered over [${ref}]` : `Failed to hover [${ref}]`;
    },
    {
      name: "browserHover",
      description:
        "Hover over an element by ref. Use to trigger tooltips, dropdown menus, " +
        "or reveal hidden elements.",
      schema: z.object({
        ref: z.string().describe("Element ref from snapshot"),
        tabId: z.string().optional(),
      }),
    },
  );

  // ── 7b. Select ───────────────────────────────────────────

  const browserSelect = tool(
    async ({ ref, value, tabId }) => {
      const res = await client.select({ ref, value, tabId });
      return res.success
        ? `Selected "${value}" in [${ref}]`
        : `Failed to select "${value}" in [${ref}]`;
    },
    {
      name: "browserSelect",
      description:
        "Select a value in a native dropdown/select element by ref. Prefer this over click sequences when the control is a real select.",
      schema: z.object({
        ref: z.string().describe("Element ref from snapshot"),
        value: z.string().describe("Option value or text to select"),
        tabId: z.string().optional(),
      }),
    },
  );

  // ── 7c. Check / Uncheck ─────────────────────────────────

  const browserCheck = tool(
    async ({ ref, tabId }) => {
      const res = await client.check({ ref, tabId });
      return res.success ? `Checked [${ref}]` : `Failed to check [${ref}]`;
    },
    {
      name: "browserCheck",
      description:
        "Check a checkbox or radio input by ref. Use instead of raw click when the control is a checkable input.",
      schema: z.object({
        ref: z.string().describe("Element ref from snapshot"),
        tabId: z.string().optional(),
      }),
    },
  );

  const browserUncheck = tool(
    async ({ ref, tabId }) => {
      const res = await client.uncheck({ ref, tabId });
      return res.success ? `Unchecked [${ref}]` : `Failed to uncheck [${ref}]`;
    },
    {
      name: "browserUncheck",
      description:
        "Uncheck a checkbox input by ref. Use when a box is checked but should be cleared.",
      schema: z.object({
        ref: z.string().describe("Element ref from snapshot"),
        tabId: z.string().optional(),
      }),
    },
  );

  // ── 8. Scroll ────────────────────────────────────────────

  const browserScroll = tool(
    async ({ direction, amount, ref, tabId }) => {
      const res = await client.scroll({ direction, amount, ref, tabId });
      return res.success
        ? `Scrolled ${direction}${ref ? ` in [${ref}]` : ""}`
        : `Failed to scroll`;
    },
    {
      name: "browserScroll",
      description:
        "Scroll the page or a specific element. Use to reveal content below the fold, " +
        "load infinite scroll content, or navigate long pages.",
      schema: z.object({
        direction: z
          .enum(["up", "down", "left", "right"])
          .describe("Scroll direction"),
        amount: z
          .number()
          .optional()
          .describe("Pixels to scroll. Default varies by direction."),
        ref: z
          .string()
          .optional()
          .describe("Element ref to scroll within. Omit to scroll the page."),
        tabId: z.string().optional(),
      }),
    },
  );

  // ── 8b. Drag ─────────────────────────────────────────────

  const browserDrag = tool(
    async ({ ref, dragX, dragY, tabId }) => {
      const res = await client.drag({ ref, dragX, dragY, tabId });
      return res.success
        ? `Dragged [${ref}] by (${dragX}, ${dragY})`
        : `Failed to drag [${ref}]`;
    },
    {
      name: "browserDrag",
      description:
        "Drag an element by pixel offset. Use for sliders, drag handles, and simple drag-and-drop interactions.",
      schema: z.object({
        ref: z.string().describe("Element ref from snapshot"),
        dragX: z.number().describe("Horizontal drag offset in pixels"),
        dragY: z.number().describe("Vertical drag offset in pixels"),
        tabId: z.string().optional(),
      }),
    },
  );

  // ── 9. Screenshot ────────────────────────────────────────

  const browserScreenshot = tool(
    async ({ tabId, fullPage, saveToPath }) => {
      const res = await client.screenshot({ tabId, fullPage });
      if (saveToPath) {
        const savedPath = await writeWorkspaceFile(
          saveToPath,
          Buffer.from(res.data, "base64"),
        );
        return `Screenshot saved to ${savedPath}`;
      }

      // Return as image content for vision models
      return {
        type: "image" as const,
        data: res.data,
        mimeType: res.mimeType,
      };
    },
    {
      name: "browserScreenshot",
      description:
        "Take a screenshot of the current page. Returns an image for visual analysis. " +
        "Use when the accessibility tree (browserSnapshot) isn't enough — " +
        "e.g., canvas elements, complex UIs, visual verification. " +
        "More expensive than snapshot (~1000 tokens).",
      schema: z.object({
        tabId: z.string().optional(),
        fullPage: z
          .boolean()
          .optional()
          .describe("Capture full page or just viewport. Default: viewport."),
        saveToPath: z
          .string()
          .optional()
          .describe(
            "Optional destination under /workspace/, e.g. /workspace/screenshots/page.png",
          ),
      }),
    },
  );

  // ── 10. Text ─────────────────────────────────────────────

  const browserText = tool(
    async ({ tabId }) => {
      const res = await client.text({ tabId });
      return `Page: ${res.url} ("${res.title}")\n\n${res.text}`;
    },
    {
      name: "browserText",
      description:
        "Extract all visible text from the page. Returns plain text without element refs. " +
        "Use when you need the full text content (e.g., reading an article, extracting data). " +
        "Cheaper than snapshot for pure text extraction.",
      schema: z.object({
        tabId: z.string().optional(),
      }),
    },
  );

  // ── 11. PDF ──────────────────────────────────────────────

  const browserPdf = tool(
    async ({ tabId, format, landscape, saveToPath }) => {
      const res = await client.pdf({ tabId, format, landscape });
      if (saveToPath) {
        const savedPath = await writeWorkspaceFile(
          saveToPath,
          Buffer.from(res.data, "base64"),
        );
        return `PDF saved to ${savedPath}`;
      }
      return `PDF generated (${res.data.length} bytes base64). Pass saveToPath to store it under /workspace/downloads/.`;
    },
    {
      name: "browserPdf",
      description:
        "Generate a PDF of the current page. Returns base64-encoded PDF data. " +
        "Save the result to /workspace/downloads/ using write_file.",
      schema: z.object({
        tabId: z.string().optional(),
        format: z
          .enum(["A4", "Letter"])
          .optional()
          .describe("Paper format. Default: A4"),
        landscape: z.boolean().optional().describe("Landscape orientation."),
        saveToPath: z
          .string()
          .optional()
          .describe(
            "Optional destination under /workspace/, e.g. /workspace/downloads/page.pdf",
          ),
      }),
    },
  );

  // ── 12. Eval ─────────────────────────────────────────────

  const browserEval = tool(
    async ({ expression, tabId }) => {
      const res = await client.eval({ expression, tabId });
      return `Result: ${JSON.stringify(res.result)}`;
    },
    {
      name: "browserEval",
      description:
        "Execute JavaScript in the page context. ALWAYS requires HITL approval. " +
        "Use for: file upload triggers, complex interactions not possible via click/fill, " +
        "extracting data from page JS variables. Be precise with your expression.",
      schema: z.object({
        expression: z.string().describe("JavaScript expression to evaluate"),
        tabId: z.string().optional(),
      }),
    },
  );

  // ── 12b. Wait ────────────────────────────────────────────

  const browserWait = tool(
    async ({ tabId, selector, state, text, url, load, fn, ms, timeout }) => {
      const res = await client.wait({
        tabId,
        selector,
        state,
        text,
        url,
        load,
        fn,
        ms,
        timeout,
      });
      return res.waited
        ? `Wait succeeded (${res.match ?? "condition matched"}) in ${res.elapsed}ms`
        : `Wait timed out after ${res.elapsed}ms${res.error ? `: ${res.error}` : ""}`;
    },
    {
      name: "browserWait",
      description:
        "Wait for a browser condition before continuing. Use after navigation, async UI updates, uploads, or submissions.",
      schema: z.object({
        tabId: z.string().optional(),
        selector: z
          .string()
          .optional()
          .describe("Wait for a selector/ref to appear or disappear"),
        state: z
          .enum(["visible", "hidden"])
          .optional()
          .describe("Selector state. Default: visible"),
        text: z
          .string()
          .optional()
          .describe("Wait until page text includes this string"),
        url: z
          .string()
          .optional()
          .describe("Wait until current URL matches this glob pattern"),
        load: z
          .enum(["networkidle"])
          .optional()
          .describe("Wait for load state"),
        fn: z
          .string()
          .optional()
          .describe("JavaScript condition to poll until truthy"),
        ms: z.number().optional().describe("Fixed sleep in milliseconds"),
        timeout: z
          .number()
          .optional()
          .describe("Maximum wait time in milliseconds"),
      }),
    },
  );

  // ── 12c. Find ────────────────────────────────────────────

  const browserFind = tool(
    async ({ query, tabId, threshold, topK, explain }) => {
      const res = await client.find({ query, tabId, threshold, topK, explain });
      const matches = res.matches
        .map(
          (m) =>
            `- [${m.ref}] ${m.role ?? "element"} "${m.name ?? ""}"${typeof m.score === "number" ? ` score=${m.score.toFixed(3)}` : ""}`,
        )
        .join("\n");
      return `Best match: [${res.best_ref}] (${res.confidence}, ${res.strategy}, score=${res.score.toFixed(3)})\n${matches}`;
    },
    {
      name: "browserFind",
      description:
        "Find the most likely element for a natural-language description using the current page snapshot. Use when many similar refs exist.",
      schema: z.object({
        query: z
          .string()
          .describe("Natural-language description of the target element"),
        tabId: z.string().optional(),
        threshold: z.number().optional(),
        topK: z.number().optional(),
        explain: z.boolean().optional(),
      }),
    },
  );

  // ── 12d. Upload ──────────────────────────────────────────

  const browserUpload = tool(
    async ({ selector, paths, tabId }) => {
      const normalizedPaths = paths.map((path) =>
        path.startsWith("/workspace/uploads/")
          ? `uploads/${path.slice("/workspace/uploads/".length)}`
          : path,
      );
      const res = await client.upload({
        selector,
        paths: normalizedPaths,
        tabId,
      });
      return res.status === "ok"
        ? `Uploaded ${res.files} file(s) with selector ${selector}`
        : `Upload failed for selector ${selector}`;
    },
    {
      name: "browserUpload",
      description:
        "Upload files into a file input. Prefer this over browserEval for standard file inputs. Files should come from /workspace/uploads/.",
      schema: z.object({
        selector: z
          .string()
          .describe(
            "Unified selector or ref for the file input. Refs from snapshot are supported.",
          ),
        paths: z
          .array(z.string())
          .describe("Paths to files under /workspace/uploads/"),
        tabId: z.string().optional(),
      }),
    },
  );

  // ── 13. Tabs ─────────────────────────────────────────────

  const browserTabs = tool(
    async () => {
      const tabs = await client.tabs();
      return tabs
        .map((t) => `${t.active ? "→ " : "  "}[${t.id}] ${t.title} (${t.url})`)
        .join("\n");
    },
    {
      name: "browserTabs",
      description:
        "List all open browser tabs with their IDs, titles, and URLs. " +
        "The active tab is marked with →.",
      schema: z.object({}),
    },
  );

  // ── 14. Close ────────────────────────────────────────────

  const browserClose = tool(
    async ({ tabId }) => {
      const res = await client.close({ tabId });
      return res.success
        ? `Closed tab ${tabId}`
        : `Failed to close tab ${tabId}`;
    },
    {
      name: "browserClose",
      description:
        "Close a browser tab by its ID. Use browserTabs to list tab IDs first.",
      schema: z.object({
        tabId: z.string().describe("ID of the tab to close"),
      }),
    },
  );

  // ── 15. Profiles ─────────────────────────────────────────

  const browserProfiles = tool(
    async () => {
      // Profiles endpoint may vary — using GET
      try {
        const res = await fetch(`${client.baseUrl}/profiles`);
        if (!res.ok) return "Failed to list profiles";
        const data = await res.json();
        return JSON.stringify(data, null, 2);
      } catch {
        return "Profiles endpoint not available";
      }
    },
    {
      name: "browserProfiles",
      description:
        "List available browser profiles. Profiles persist cookies and login sessions.",
      schema: z.object({}),
    },
  );

  return [
    browserNavigate,
    browserSnapshot,
    browserClick,
    browserFill,
    browserFocus,
    browserType,
    browserPress,
    browserHover,
    browserSelect,
    browserCheck,
    browserUncheck,
    browserScroll,
    browserDrag,
    browserScreenshot,
    browserText,
    browserPdf,
    browserEval,
    browserWait,
    browserFind,
    browserUpload,
    browserTabs,
    browserClose,
    browserProfiles,
  ] as const;
}

/** Type for the array of browser tools */
export type BrowserTools = ReturnType<typeof createBrowserTools>;
