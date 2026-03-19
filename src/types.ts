// ── Provider & Config Types ──────────────────────────────────

export const PROVIDERS = [
  "anthropic",
  "openai",
  "google-genai",
  "deepseek",
  "ollama",
] as const;

export type Provider = (typeof PROVIDERS)[number];

export const TRUST_LEVELS = ["strict", "moderate", "permissive"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const PINCHTAB_MODES = ["headless", "headed"] as const;
export type PinchTabMode = (typeof PINCHTAB_MODES)[number];

export interface AtehnaConfig {
  provider: Provider;
  apiKey: string;
  model: string; // "provider:model-name"
  trustLevel: TrustLevel;
  pinchtabPort: number;
  pinchtabAutoStart: boolean;
  pinchtabMode: PinchTabMode;
  pinchtabConfigPath?: string;
  pinchtabToken?: string;
}

/** Maps provider → env var name for API key */
export const PROVIDER_KEY_ENV: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  "google-genai": "GOOGLE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

/** Maps provider → default model string */
export const PROVIDER_DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "anthropic:claude-sonnet-4-6",
  openai: "openai:gpt-4o",
  "google-genai": "google-genai:gemini-2.5-pro",
  deepseek: "deepseek:deepseek-chat",
  ollama: "openai:llama3.3",
};

// ── PinchTab Types ───────────────────────────────────────────

export interface PinchTabConfig {
  baseUrl: string;
  timeout: number;
}

export interface PinchTabInstanceInfo {
  id: string;
  profileId?: string;
  profileName?: string;
  port?: string;
  url?: string;
  headless: boolean;
  status: string;
  attached?: boolean;
}

// -- Navigate --
export interface NavigateRequest {
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  tabId?: string;
}

export interface NavigateResponse {
  url: string;
  title: string;
  tabId: string;
}

// -- Snapshot --
export interface SnapshotRequest {
  tabId?: string;
  filter?: "all" | "interactive" | "visible";
}

export interface SnapshotResponse {
  content: string; // accessibility tree text
  url: string;
  title: string;
}

// -- Click --
export interface ClickRequest {
  ref: string; // element ref like "e0", "e1"
  tabId?: string;
  button?: "left" | "right" | "middle";
  clickCount?: number;
}

export interface ClickResponse {
  success: boolean;
  ref: string;
}

// -- Fill --
export interface FillRequest {
  ref: string;
  value: string;
  tabId?: string;
}

export interface FillResponse {
  success: boolean;
  ref: string;
}

// -- Focus --
export interface FocusRequest {
  ref: string;
  tabId?: string;
}

export interface FocusResponse {
  success: boolean;
  ref: string;
}

// -- Select --
export interface SelectRequest {
  ref: string;
  value: string;
  tabId?: string;
}

export interface SelectResponse {
  success: boolean;
  ref: string;
  value: string;
}

// -- Check/Uncheck --
export interface CheckRequest {
  ref: string;
  tabId?: string;
}

export interface CheckResponse {
  success: boolean;
  ref: string;
  checked: boolean;
}

// -- Type --
export interface TypeRequest {
  text: string;
  tabId?: string;
  delay?: number; // ms between keystrokes
}

export interface TypeResponse {
  success: boolean;
}

// -- Press --
export interface PressRequest {
  key: string; // "Enter", "Tab", "Escape", etc.
  tabId?: string;
  modifiers?: ("Shift" | "Control" | "Alt" | "Meta")[];
}

export interface PressResponse {
  success: boolean;
}

// -- Hover --
export interface HoverRequest {
  ref: string;
  tabId?: string;
}

export interface HoverResponse {
  success: boolean;
  ref: string;
}

// -- Drag --
export interface DragRequest {
  ref: string;
  dragX: number;
  dragY: number;
  tabId?: string;
}

export interface DragResponse {
  success: boolean;
  ref: string;
}

// -- Scroll --
export interface ScrollRequest {
  direction: "up" | "down" | "left" | "right";
  amount?: number; // pixels, default varies
  ref?: string; // scroll within element, or page if omitted
  tabId?: string;
}

export interface ScrollResponse {
  success: boolean;
}

// -- Eval --
export interface EvalRequest {
  expression: string;
  tabId?: string;
}

export interface EvalResponse {
  result: unknown;
}

// -- Screenshot --
export interface ScreenshotRequest {
  tabId?: string;
  fullPage?: boolean;
  format?: "png" | "jpeg";
  quality?: number; // 0-100, jpeg only
}

export interface ScreenshotResponse {
  data: string; // base64 encoded
  mimeType: string;
}

// -- Wait --
export interface WaitRequest {
  tabId?: string;
  selector?: string;
  state?: "visible" | "hidden";
  text?: string;
  url?: string;
  load?: "networkidle";
  fn?: string;
  ms?: number;
  timeout?: number;
}

export interface WaitResponse {
  waited: boolean;
  elapsed: number;
  match?: string;
  error?: string;
}

// -- Find --
export interface FindRequest {
  query: string;
  tabId?: string;
  threshold?: number;
  topK?: number;
  explain?: boolean;
}

export interface FindMatch {
  ref: string;
  role?: string;
  name?: string;
  score?: number;
  reason?: string;
}

export interface FindResponse {
  best_ref: string;
  confidence: string;
  score: number;
  matches: FindMatch[];
  strategy: string;
  threshold: number;
  latency_ms: number;
  element_count: number;
  idpiWarning?: string;
}

// -- Upload --
export interface UploadRequest {
  selector: string;
  tabId?: string;
  paths?: string[];
  files?: string[];
}

export interface UploadResponse {
  status: string;
  files: number;
}

// -- Text --
export interface TextRequest {
  tabId?: string;
}

export interface TextResponse {
  text: string;
  url: string;
  title: string;
}

// -- PDF --
export interface PdfRequest {
  tabId?: string;
  format?: "A4" | "Letter";
  landscape?: boolean;
}

export interface PdfResponse {
  data: string; // base64 encoded
}

// -- Tabs --
export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export type TabsResponse = TabInfo[];

// -- Close --
export interface CloseRequest {
  tabId: string;
}

export interface CloseResponse {
  success: boolean;
}

// ── Agent Event Types (for AgentAPI) ─────────────────────────

export interface TokenEvent {
  agent: string; // lc_agent_name
  content: string;
}

export interface AgentSwitchEvent {
  from: string;
  to: string;
}

export interface HitlRequestEvent {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  agent: string;
}

export type HitlDecision =
  | { type: "approve" }
  | { type: "edit"; args: Record<string, unknown> }
  | { type: "reject" }
  | string;

export interface TaskResult {
  success: boolean;
  message: string;
  files: string[];
}
