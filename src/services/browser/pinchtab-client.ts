import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PinchTabConfig,
  PinchTabInstanceInfo,
  NavigateRequest,
  NavigateResponse,
  SnapshotRequest,
  ClickRequest,
  FillRequest,
  FocusRequest,
  FocusResponse,
  SelectRequest,
  SelectResponse,
  CheckRequest,
  CheckResponse,
  TypeRequest,
  PressRequest,
  HoverRequest,
  DragRequest,
  DragResponse,
  ScrollRequest,
  EvalRequest,
  EvalResponse,
  ScreenshotRequest,
  WaitRequest,
  WaitResponse,
  FindRequest,
  FindResponse,
  UploadRequest,
  UploadResponse,
  TextRequest,
  PdfRequest,
  CloseRequest,
  CloseResponse,
} from "../../types.js";

// ── PinchTab actual response shapes ──────────────────────────

interface PtSnapshotNode {
  ref: string;
  role: string;
  name: string;
  depth: number;
  focused?: boolean;
  nodeId: number;
}

interface PtSnapshotResponse {
  count: number;
  nodes: PtSnapshotNode[];
  title: string;
  url: string;
}

interface PtActionResponse {
  success: boolean;
  result?: Record<string, unknown>;
  code?: string;
  error?: string;
}

interface PtTabsResponse {
  tabs: Array<{
    id: string;
    title: string;
    type: string;
    url: string;
  }>;
}

interface PtTextResponse {
  text: string;
  title: string;
  url: string;
  truncated: boolean;
}

interface PtScreenshotResponse {
  base64: string;
}

interface PtWaitResponse {
  waited: boolean;
  elapsed: number;
  match?: string;
  error?: string;
}

// ── Client ───────────────────────────────────────────────────

export class PinchTabClient {
  public readonly baseUrl: string;
  private timeout: number;
  private token: string | undefined;
  private defaultInstanceId: string | null = null;
  private currentTabId: string | null = null;

  constructor(config?: Partial<PinchTabConfig> & { token?: string }) {
    const port = config?.baseUrl
      ? undefined
      : process.env.PINCHTAB_PORT || "9867";
    this.baseUrl = config?.baseUrl || `http://localhost:${port}`;
    this.timeout = config?.timeout || 30_000;
    this.token =
      config?.token ||
      process.env.PINCHTAB_TOKEN ||
      PinchTabClient.readTokenFromConfig();
  }

  /** Read token from ~/.pinchtab/config.json if it exists */
  private static readTokenFromConfig(): string | undefined {
    try {
      const configPath =
        process.env.PINCHTAB_CONFIG ||
        join(
          process.env.HOME || process.env.USERPROFILE || "",
          ".pinchtab",
          "config.json",
        );
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return parsed?.server?.token || undefined;
    } catch {
      return undefined;
    }
  }

  /** Build headers with auth token if available */
  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    return h;
  }

  setDefaultInstanceId(instanceId: string | null): void {
    this.defaultInstanceId = instanceId;
  }

  getDefaultInstanceId(): string | null {
    return this.defaultInstanceId;
  }

  private resolveTabId(tabId?: string): string | undefined {
    return tabId || this.currentTabId || undefined;
  }

  // ── HTTP helpers ─────────────────────────────────────────

  private async post<T>(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `PinchTab ${endpoint} failed (${res.status}): ${text || res.statusText}`,
        );
      }

      return (await res.json()) as T;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `PinchTab ${endpoint} timed out after ${this.timeout}ms`,
        );
      }
      if (
        err instanceof TypeError &&
        (err.message.includes("fetch failed") ||
          err.message.includes("ECONNREFUSED"))
      ) {
        throw new Error(
          `PinchTab not reachable at ${this.baseUrl}. Is it running?`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(
    endpoint: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }

    try {
      const res = await fetch(url.toString(), {
        headers: this.headers(),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `PinchTab GET ${endpoint} failed (${res.status}): ${text || res.statusText}`,
        );
      }

      return (await res.json()) as T;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `PinchTab GET ${endpoint} timed out after ${this.timeout}ms`,
        );
      }
      if (
        err instanceof TypeError &&
        (err.message.includes("fetch failed") ||
          err.message.includes("ECONNREFUSED"))
      ) {
        throw new Error(
          `PinchTab not reachable at ${this.baseUrl}. Is it running?`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** POST /action — unified action endpoint */
  private async action(
    kind: string,
    params: Record<string, unknown>,
  ): Promise<PtActionResponse> {
    return this.post<PtActionResponse>("/action", { kind, ...params });
  }

  // ── Health ───────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers(),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Navigation ───────────────────────────────────────────

  async navigate(req: NavigateRequest): Promise<NavigateResponse> {
    const tabId = this.resolveTabId(req.tabId);

    if (tabId) {
      const res = await this.post<NavigateResponse>(`/tabs/${tabId}/navigate`, {
        url: req.url,
      });
      this.currentTabId = res.tabId;
      return res;
    }

    if (this.defaultInstanceId) {
      const res = await this.post<NavigateResponse>(
        `/instances/${this.defaultInstanceId}/tabs/open`,
        { url: req.url },
      );
      this.currentTabId = res.tabId;
      return res;
    }

    const res = await this.post<NavigateResponse>(
      "/navigate",
      req as unknown as Record<string, unknown>,
    );
    this.currentTabId = res.tabId;
    return res;
  }

  // ── GET Endpoints ────────────────────────────────────────

  async snapshot(
    req?: SnapshotRequest,
  ): Promise<{ content: string; url: string; title: string }> {
    const params: Record<string, string> = {};
    const tabId = this.resolveTabId(req?.tabId);
    if (tabId) params.tab = tabId;
    if (req?.filter === "interactive") params.interactive = "true";

    const res = await this.get<PtSnapshotResponse>("/snapshot", params);

    // Format nodes into readable accessibility tree text
    const content = res.nodes
      .map((n) => {
        const indent = "  ".repeat(n.depth);
        const focused = n.focused ? " (focused)" : "";
        return `${indent}[${n.ref}] ${n.role}: "${n.name}"${focused}`;
      })
      .join("\n");

    return { content, url: res.url, title: res.title };
  }

  async screenshot(
    req?: ScreenshotRequest,
  ): Promise<{ data: string; mimeType: string }> {
    const params: Record<string, string> = {};
    const tabId = this.resolveTabId(req?.tabId);
    if (tabId) params.tab = tabId;
    if (req?.fullPage) params.fullPage = "true";

    const res = await this.get<PtScreenshotResponse>("/screenshot", params);
    return { data: res.base64, mimeType: "image/jpeg" };
  }

  async text(
    req?: TextRequest,
  ): Promise<{ text: string; url: string; title: string }> {
    const params: Record<string, string> = {};
    const tabId = this.resolveTabId(req?.tabId);
    if (tabId) params.tab = tabId;

    return this.get<PtTextResponse>("/text", params);
  }

  async pdf(req?: PdfRequest): Promise<{ data: string }> {
    const params: Record<string, string> = {};
    const tabId = this.resolveTabId(req?.tabId);
    if (tabId) params.tab = tabId;

    const res = await this.get<{ base64: string }>("/pdf", params);
    return { data: res.base64 };
  }

  async tabs(): Promise<
    Array<{ id: string; url: string; title: string; active: boolean }>
  > {
    if (this.defaultInstanceId) {
      const res = await this.get<
        Array<{ id: string; url: string; title: string }>
      >(`/instances/${this.defaultInstanceId}/tabs`);
      this.currentTabId = res[0]?.id ?? this.currentTabId;
      return res.map((t, i) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: i === 0,
      }));
    }

    const res = await this.get<PtTabsResponse>("/tabs");
    this.currentTabId = res.tabs[0]?.id ?? this.currentTabId;
    return res.tabs.map((t, i) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: i === 0, // First tab is typically active
    }));
  }

  async instances(): Promise<PinchTabInstanceInfo[]> {
    return this.get<PinchTabInstanceInfo[]>("/instances");
  }

  async startInstance(req: {
    mode: "headless" | "headed";
    profileId?: string;
    name?: string;
  }): Promise<PinchTabInstanceInfo> {
    return this.post<PinchTabInstanceInfo>("/instances/start", {
      mode: req.mode,
      ...(req.profileId && { profileId: req.profileId }),
      ...(req.name && { name: req.name }),
    });
  }

  // ── Action Endpoints (POST /action with kind) ───────────

  async click(req: ClickRequest): Promise<{ success: boolean; ref: string }> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("click", {
      ref: req.ref,
      ...(tabId && { tab: tabId }),
      ...(req.button && { button: req.button }),
      ...(req.clickCount && { count: req.clickCount }),
    });
    return { success: res.success, ref: req.ref };
  }

  async fill(req: FillRequest): Promise<{ success: boolean; ref: string }> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("fill", {
      ref: req.ref,
      value: req.value,
      ...(tabId && { tab: tabId }),
    });
    return { success: res.success, ref: req.ref };
  }

  async focus(req: FocusRequest): Promise<FocusResponse> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("focus", {
      ref: req.ref,
      ...(tabId && { tab: tabId }),
    });
    return { success: res.success, ref: req.ref };
  }

  async select(req: SelectRequest): Promise<SelectResponse> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("select", {
      ref: req.ref,
      value: req.value,
      ...(tabId && { tab: tabId }),
    });
    return { success: res.success, ref: req.ref, value: req.value };
  }

  async check(req: CheckRequest): Promise<CheckResponse> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("check", {
      ref: req.ref,
      ...(tabId && { tab: tabId }),
    });
    return { success: res.success, ref: req.ref, checked: true };
  }

  async uncheck(req: CheckRequest): Promise<CheckResponse> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("uncheck", {
      ref: req.ref,
      ...(tabId && { tab: tabId }),
    });
    return { success: res.success, ref: req.ref, checked: false };
  }

  async type(req: TypeRequest): Promise<{ success: boolean }> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("type", {
      text: req.text,
      ...(tabId && { tab: tabId }),
      ...(req.delay && { delay: req.delay }),
    });
    return { success: res.success };
  }

  async press(req: PressRequest): Promise<{ success: boolean }> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("press", {
      key: req.key,
      ...(tabId && { tab: tabId }),
      ...(req.modifiers && { modifiers: req.modifiers }),
    });
    return { success: res.success };
  }

  async hover(req: HoverRequest): Promise<{ success: boolean; ref: string }> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("hover", {
      ref: req.ref,
      ...(tabId && { tab: tabId }),
    });
    return { success: res.success, ref: req.ref };
  }

  async drag(req: DragRequest): Promise<DragResponse> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("drag", {
      ref: req.ref,
      dragX: req.dragX,
      dragY: req.dragY,
      ...(tabId && { tab: tabId }),
    });
    return { success: res.success, ref: req.ref };
  }

  async scroll(req: ScrollRequest): Promise<{ success: boolean }> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.action("scroll", {
      direction: req.direction,
      ...(req.amount && { amount: req.amount }),
      ...(req.ref && { ref: req.ref }),
      ...(tabId && { tab: tabId }),
    });
    return { success: res.success };
  }

  async eval(req: EvalRequest): Promise<EvalResponse> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.post<{ result: unknown }>("/evaluate", {
      expression: req.expression,
      ...(tabId && { tab: tabId }),
    });
    return { result: res.result };
  }

  async wait(req: WaitRequest): Promise<WaitResponse> {
    const tabId = this.resolveTabId(req.tabId);
    const res = await this.post<PtWaitResponse>(
      tabId ? `/tabs/${tabId}/wait` : "/wait",
      {
        ...(req.selector && { selector: req.selector }),
        ...(req.state && { state: req.state }),
        ...(req.text && { text: req.text }),
        ...(req.url && { url: req.url }),
        ...(req.load && { load: req.load }),
        ...(req.fn && { fn: req.fn }),
        ...(typeof req.ms === "number" && { ms: req.ms }),
        ...(typeof req.timeout === "number" && { timeout: req.timeout }),
      },
    );
    return res;
  }

  async find(req: FindRequest): Promise<FindResponse> {
    const tabId = this.resolveTabId(req.tabId);
    return this.post<FindResponse>("/find", {
      query: req.query,
      ...(tabId && { tabId }),
      ...(typeof req.threshold === "number" && { threshold: req.threshold }),
      ...(typeof req.topK === "number" && { topK: req.topK }),
      ...(typeof req.explain === "boolean" && { explain: req.explain }),
    });
  }

  async upload(req: UploadRequest): Promise<UploadResponse> {
    const tabId = this.resolveTabId(req.tabId);
    return this.post<UploadResponse>("/upload", {
      selector: req.selector,
      ...(tabId && { tabId }),
      ...(req.paths && req.paths.length > 0 && { paths: req.paths }),
      ...(req.files && req.files.length > 0 && { files: req.files }),
    });
  }

  async close(req: CloseRequest): Promise<CloseResponse> {
    const tabId = this.resolveTabId(req.tabId);
    if (!tabId) {
      throw new Error(
        "PinchTab close requires a tab ID or an active current tab.",
      );
    }

    const res = await this.post<{ closed?: boolean; status?: string }>(
      `/tabs/${tabId}/close`,
      {},
    );
    if (tabId === this.currentTabId) {
      this.currentTabId = null;
    }
    return { success: res.closed === true || res.status === "closed" };
  }
}
