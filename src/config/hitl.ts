import type { InterruptOnConfig } from "langchain";
import type { TrustLevel } from "../types.js";

/**
 * Build the interruptOn config based on the user's trust level.
 *
 * Trust tiers:
 *   strict    — ALL browser actions need approval
 *   moderate  — only sensitive tools (fill, eval, submit)
 *   permissive — only eval (arbitrary JS execution)
 *
 * Note: browserFill's own sensitive-field detection (password, CVV, etc.)
 * triggers HITL regardless of trust level — that's handled inside the tool itself.
 */
export function buildInterruptOn(
  trustLevel: TrustLevel
): Record<string, boolean | InterruptOnConfig> {
  const approveOrReject: InterruptOnConfig = {
    allowedDecisions: ["approve", "reject"],
  };

  const approveEditReject: InterruptOnConfig = {
    allowedDecisions: ["approve", "edit", "reject"],
  };

  switch (trustLevel) {
    case "strict":
      // Every browser action needs approval
      return {
        browserNavigate: approveOrReject,
        browserClick: approveOrReject,
        browserFill: approveEditReject,
        browserType: approveEditReject,
        browserPress: approveOrReject,
        browserHover: approveOrReject,
        browserScroll: approveOrReject,
        browserEval: approveOrReject,
        browserClose: approveOrReject,
      };

    case "moderate":
      // Only sensitive actions: fill (editable), eval, and form submits
      return {
        browserFill: approveEditReject,
        browserEval: approveOrReject,
      };

    case "permissive":
      // Only arbitrary JS execution
      return {
        browserEval: approveOrReject,
      };
  }
}
