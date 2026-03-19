import "dotenv/config";
import {
  PROVIDERS,
  PROVIDER_KEY_ENV,
  PROVIDER_DEFAULT_MODEL,
  TRUST_LEVELS,
  PINCHTAB_MODES,
  type Provider,
  type TrustLevel,
  type AtehnaConfig,
} from "../types.js";

/**
 * Detect which provider is configured by checking for API keys in env.
 * Returns the first provider that has a key set.
 */
function detectProvider(): Provider | null {
  for (const provider of PROVIDERS) {
    const envVar = PROVIDER_KEY_ENV[provider];
    if (process.env[envVar]) {
      return provider;
    }
  }
  return null;
}

/**
 * Load and validate config from environment variables.
 * Throws with clear error messages if config is invalid.
 */
export function loadConfig(): AtehnaConfig {
  // 1. Determine provider
  const explicitProvider = process.env.ATEHNA_PROVIDER as Provider | undefined;
  const detectedProvider = detectProvider();
  const provider = explicitProvider || detectedProvider;

  if (!provider) {
    throw new Error(
      `No provider configured. Set ATEHNA_PROVIDER and an API key.\n` +
        `Supported providers: ${PROVIDERS.join(", ")}\n` +
        `Example:\n` +
        `  ATEHNA_PROVIDER=anthropic\n` +
        `  ANTHROPIC_API_KEY=sk-ant-...`,
    );
  }

  if (!PROVIDERS.includes(provider)) {
    throw new Error(
      `Invalid provider "${provider}". Must be one of: ${PROVIDERS.join(", ")}`,
    );
  }

  // 2. Get API key
  const keyEnv = PROVIDER_KEY_ENV[provider];
  const apiKey = process.env[keyEnv];

  if (!apiKey) {
    throw new Error(
      `Provider "${provider}" selected but ${keyEnv} is not set.\n` +
        `Add to .env:\n` +
        `  ${keyEnv}=your-api-key-here`,
    );
  }

  // 3. Determine model
  const model = process.env.ATEHNA_MODEL || PROVIDER_DEFAULT_MODEL[provider];

  // 4. Trust level
  const trustLevel = (process.env.ATEHNA_TRUST_LEVEL ||
    "moderate") as TrustLevel;
  if (!TRUST_LEVELS.includes(trustLevel)) {
    throw new Error(
      `Invalid trust level "${trustLevel}". Must be one of: ${TRUST_LEVELS.join(", ")}`,
    );
  }

  // 5. PinchTab config
  const pinchtabPort = parseInt(process.env.PINCHTAB_PORT || "9867", 10);
  if (isNaN(pinchtabPort) || pinchtabPort < 1 || pinchtabPort > 65535) {
    throw new Error(`Invalid PINCHTAB_PORT. Must be 1-65535.`);
  }

  const pinchtabAutoStart = process.env.PINCHTAB_AUTO_START !== "false";
  const pinchtabMode = (process.env.PINCHTAB_MODE || "headless").toLowerCase();
  if (
    !PINCHTAB_MODES.includes(pinchtabMode as (typeof PINCHTAB_MODES)[number])
  ) {
    throw new Error(
      `Invalid PINCHTAB_MODE "${pinchtabMode}". Must be one of: ${PINCHTAB_MODES.join(", ")}`,
    );
  }

  return {
    provider,
    apiKey,
    model,
    trustLevel,
    pinchtabPort,
    pinchtabAutoStart,
    pinchtabMode: pinchtabMode as AtehnaConfig["pinchtabMode"],
    pinchtabConfigPath: process.env.PINCHTAB_CONFIG || undefined,
    pinchtabToken: process.env.PINCHTAB_TOKEN || undefined,
  };
}
