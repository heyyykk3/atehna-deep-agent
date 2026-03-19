import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Vision verify tool — uses patchright (stealth Playwright) to capture
 * a screenshot and return it as a base64 image for LLM visual analysis.
 *
 * Borrowed from PR version's visionVerifyTool pattern.
 *
 * Use cases:
 * - When PinchTab's accessibility snapshot isn't enough
 * - When you need to verify visual layout, images, or canvas elements
 * - When bot detection blocks PinchTab but patchright can bypass it
 * - As a fallback for visual verification on complex pages
 *
 * This tool launches a fresh patchright browser per call (expensive),
 * so use it sparingly.
 */
export const visionVerifyTool = tool(
  async ({ url, description }) => {
    let chromium: { launch: (opts: { headless: boolean }) => Promise<any> };
    try {
      // Dynamic import — patchright may not be installed
      // @ts-expect-error — patchright is an optional dependency
      const patchright = await import("patchright");
      chromium = patchright.chromium;
    } catch {
      return `[Vision] patchright not installed. Install with: npm install patchright\nCannot perform visual verification.`;
    }

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

      const screenshotBuffer = await page.screenshot({
        type: "jpeg",
        quality: 80,
      });
      const base64Image = screenshotBuffer.toString("base64");

      return [
        {
          type: "text" as const,
          text: `[Vision] Captured screenshot of ${url}${description ? `. Verify: ${description}` : ""}. Analyze the image below.`,
        },
        {
          type: "image_url" as const,
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`,
          },
        },
      ];
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `[Vision Error] Failed to capture screenshot: ${msg}`;
    } finally {
      if (browser) await browser.close();
    }
  },
  {
    name: "visionVerify",
    description:
      "Takes a screenshot using patchright (anti-detection browser) and returns " +
      "the image for visual analysis. Use ONLY when: (1) PinchTab snapshot/screenshot " +
      "is insufficient, (2) you need to bypass bot detection for visual check, " +
      "(3) complex visual verification is needed. Expensive — use sparingly.",
    schema: z.object({
      url: z.string().describe("The URL to navigate to and screenshot"),
      description: z
        .string()
        .optional()
        .describe("What to verify in the screenshot (e.g., 'form submitted successfully')"),
    }),
  },
);
