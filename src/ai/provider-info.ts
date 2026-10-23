/**
 * Per-provider facts that the settings UI and the server both need. No SDK
 * imports here, so client components can use it.
 */
export type Provider = "anthropic" | "openai";

export const DEFAULT_MODELS = { anthropic: "claude-sonnet-5-5", openai: "gpt-5.4-mini" } as const satisfies Record<Provider, string>;

export const PROVIDER_INFO = {
  anthropic: { label: "Anthropic", keyPlaceholder: "sk-ant-…", keyHelp: "Anthropic keys start with sk-ant-." },
  openai: { label: "OpenAI", keyPlaceholder: "sk-…", keyHelp: "OpenAI keys start with sk-." },
} as const satisfies Record<Provider, { label: string; keyPlaceholder: string; keyHelp: string }>;

/** A cheap, local check that the key looks like it belongs to the chosen provider. Null means it looks right. */
export function checkKeyFormat(provider: Provider, apiKey: string): string | null {
  const looksAnthropic = apiKey.startsWith("sk-ant-");
  if (provider === "anthropic") {
    if (looksAnthropic) return null;
    if (apiKey.startsWith("sk-")) return "That looks like an OpenAI key. Switch the provider to OpenAI.";
    return "Anthropic keys start with sk-ant-.";
  }
  if (looksAnthropic) return "That looks like an Anthropic key. Switch the provider to Anthropic.";
  if (!apiKey.startsWith("sk-")) return "OpenAI keys start with sk-.";
  return null;
}
