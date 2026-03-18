# Deep Agents — Supported Providers

Deep Agents supports **17 model providers** via LangChain's `initChatModel()`.

## Usage

Model strings use the format `"provider:model-name"`:

```typescript
const agent = createDeepAgent({
  model: "google-genai:gemini-3.1-pro-preview",
});
```

Or pass a pre-constructed instance:

```typescript
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

const agent = createDeepAgent({
  model: new ChatGoogleGenerativeAI({
    model: "gemini-3.1-pro-preview",
    temperature: 0,
  }),
});
```

## All 17 Providers

| #  | Provider Prefix        | npm Package                                   | Class Name                | Example String                          | API Key Env Var           |
|----|------------------------|-----------------------------------------------|---------------------------|-----------------------------------------|---------------------------|
| 1  | `openai`               | `@langchain/openai`                           | `ChatOpenAI`              | `"openai:gpt-4o"`                       | `OPENAI_API_KEY`          |
| 2  | `anthropic`            | `@langchain/anthropic`                        | `ChatAnthropic`           | `"anthropic:claude-sonnet-4-20250514"` | `ANTHROPIC_API_KEY`       |
| 3  | `google-genai`         | `@langchain/google-genai`                     | `ChatGoogleGenerativeAI`  | `"google-genai:gemini-3.1-pro-preview"` | `GOOGLE_API_KEY`          |
| 4  | `google-vertexai`      | `@langchain/google-vertexai`                  | `ChatVertexAI`            | `"google-vertexai:gemini-pro"`          | GCP credentials           |
| 5  | `google-vertexai-web`  | `@langchain/google-vertexai-web`              | `ChatVertexAI`            | `"google-vertexai-web:gemini-pro"`      | GCP credentials           |
| 6  | `azure_openai`         | `@langchain/openai`                           | `AzureChatOpenAI`         | `"azure_openai:my-deployment"`          | `AZURE_OPENAI_API_KEY`    |
| 7  | `ollama`               | `@langchain/ollama`                           | `ChatOllama`              | `"ollama:llama3"`                       | None (local)              |
| 8  | `groq`                 | `@langchain/groq`                             | `ChatGroq`                | `"groq:llama-3.3-70b"`                 | `GROQ_API_KEY`            |
| 9  | `mistralai`            | `@langchain/mistralai`                        | `ChatMistralAI`           | `"mistralai:mistral-large"`             | `MISTRAL_API_KEY`         |
| 10 | `mistral`              | `@langchain/mistralai`                        | `ChatMistralAI`           | `"mistral:mistral-large"` (alias)       | `MISTRAL_API_KEY`         |
| 11 | `deepseek`             | `@langchain/deepseek`                         | `ChatDeepSeek`            | `"deepseek:deepseek-chat"`              | `DEEPSEEK_API_KEY`        |
| 12 | `xai`                  | `@langchain/xai`                              | `ChatXAI`                 | `"xai:grok-2"`                          | `XAI_API_KEY`             |
| 13 | `cohere`               | `@langchain/cohere`                           | `ChatCohere`              | `"cohere:command-r-plus"`               | `COHERE_API_KEY`          |
| 14 | `bedrock`              | `@langchain/aws`                              | `ChatBedrockConverse`     | `"bedrock:anthropic.claude-3"`          | AWS credentials           |
| 15 | `cerebras`             | `@langchain/cerebras`                         | `ChatCerebras`            | `"cerebras:llama3.1-8b"`               | `CEREBRAS_API_KEY`        |
| 16 | `fireworks`            | `@langchain/community`                        | `ChatFireworks`           | `"fireworks:accounts/fireworks/..."`    | `FIREWORKS_API_KEY`       |
| 17 | `together`             | `@langchain/community`                        | `ChatTogetherAI`          | `"together:meta-llama/..."`             | `TOGETHER_API_KEY`        |
| 18 | `perplexity`           | `@langchain/community`                        | `ChatPerplexity`          | `"perplexity:sonar-pro"`               | `PERPLEXITY_API_KEY`      |

## Auto-Inference (No Prefix Needed)

If you omit the provider prefix, the model name is matched automatically:

| Model starts with              | Inferred provider  |
|--------------------------------|--------------------|
| `gpt-3`, `gpt-4`, `gpt-5`, `o1`, `o3`, `o4` | `openai`           |
| `claude`                       | `anthropic`        |
| `command`                      | `cohere`           |
| `accounts/fireworks`           | `fireworks`        |
| `gemini`                       | `google-vertexai`  |
| `amazon.`                      | `bedrock`          |
| `mistral`                      | `mistralai`        |
| `sonar`, `pplx`               | `perplexity`       |

**Note:** Auto-inference maps `gemini` to `google-vertexai`, not `google-genai`. Use the explicit prefix `google-genai:` for the Gemini API.

## Multi-Provider Setup

Different models per subagent:

```typescript
const agent = createDeepAgent({
  model: "google-genai:gemini-3.1-pro-preview",  // main agent
  subagents: [
    {
      name: "researcher",
      model: "deepseek:deepseek-chat",  // cheap for research
      // ...
    },
    {
      name: "coder",
      model: "anthropic:claude-sonnet-4-20250514",  // best at code
      // ...
    },
    {
      name: "tester",
      model: "groq:llama-3.3-70b",  // fast for test runs
      // ...
    },
  ],
});
```

## Anthropic-Specific Optimizations

When an Anthropic model is detected, Deep Agents automatically enables:
- **Prompt caching middleware** — caches system prompt prefixes for cost savings
- **Cache breakpoints** — adds `cache_control: { type: "ephemeral" }` to memory blocks
- Detection works via model string prefix (`anthropic:` or `claude`) or class name (`ChatAnthropic`)

## Installing Provider Packages

```bash
# Google Gemini (already installed)
npm install @langchain/google-genai

# OpenAI
npm install @langchain/openai

# Anthropic
npm install @langchain/anthropic

# Ollama (local, free)
npm install @langchain/ollama

# Groq (fast inference)
npm install @langchain/groq

# DeepSeek
npm install @langchain/deepseek

# Mistral
npm install @langchain/mistralai

# xAI (Grok)
npm install @langchain/xai

# AWS Bedrock
npm install @langchain/aws

# Multiple at once
npm install @langchain/openai @langchain/anthropic @langchain/groq
```
