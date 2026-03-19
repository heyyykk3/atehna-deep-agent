import { providerStrategy, toolStrategy } from "langchain";
import { initChatModel } from "langchain/chat_models/universal";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { AtehnaConfig, Provider } from "../types.js";

/**
 * Ollama Cloud base URL for the OpenAI-compatible API.
 * Can be overridden via OLLAMA_BASE_URL env var (for local Ollama too).
 */
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "https://ollama.com/v1";

/**
 * Get the model for the configured provider.
 */
export function getModel(config: AtehnaConfig): string | BaseLanguageModel {
  if (config.provider === "ollama") {
    const modelName = config.model.replace(/^openai:/, "");
    return new ChatOpenAI({
      model: modelName,
      apiKey: config.apiKey,
      configuration: { baseURL: OLLAMA_BASE_URL },
    });
  }

  return config.model;
}

/**
 * Get the model string for display/logging.
 */
export function getModelString(config: AtehnaConfig): string {
  return config.model;
}

/**
 * Create a pre-configured model instance.
 */
export async function createModel(config: AtehnaConfig) {
  if (config.provider === "ollama") {
    return getModel(config);
  }
  return await initChatModel(config.model);
}

/**
 * Returns the npm package required for the selected provider.
 */
export function getProviderPackage(provider: Provider): string {
  const packages: Record<Provider, string> = {
    anthropic: "@langchain/anthropic",
    openai: "@langchain/openai",
    "google-genai": "@langchain/google-genai",
    deepseek: "@langchain/deepseek",
    ollama: "@langchain/openai",
  };
  return packages[provider];
}

/**
 * Validate that the required provider package is installed.
 */
export async function validateProviderInstalled(
  config: AtehnaConfig,
): Promise<void> {
  const pkg = getProviderPackage(config.provider);
  try {
    await import(pkg);
  } catch {
    throw new Error(
      `Provider "${config.provider}" requires package "${pkg}".\n` +
        `Install it:\n` +
        `  npm install ${pkg}`,
    );
  }

  if (config.provider !== "ollama") {
    await initChatModel(config.model);
  }
}

/**
 * Pick the best structured-output strategy for the provider.
 */
export function getStructuredOutputStrategy<TSchema extends z.ZodTypeAny>(
  provider: Provider,
  schema: TSchema,
) {
  switch (provider) {
    case "anthropic":
    case "openai":
      return providerStrategy(schema);
    default:
      return toolStrategy(schema);
  }
}
