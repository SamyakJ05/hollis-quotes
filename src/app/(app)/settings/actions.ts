"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkKeyFormat } from "@/ai/provider-info";
import { verifyKey } from "@/ai/providers";
import { requireTenant } from "@/server/session";

const KeyInput = z.object({
  provider: z.enum(["anthropic", "openai"]),
  apiKey: z.string().trim().min(20, "That doesn't look like a full API key").max(300),
  model: z.string().trim().max(100).regex(/^[\w.:-]*$/, "Model name has odd characters"),
});

export async function saveKey(_prev: { error?: string; ok?: string } | undefined, form: FormData) {
  const parsed = KeyInput.safeParse({ provider: form.get("provider"), apiKey: form.get("apiKey"), model: form.get("model") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { provider, apiKey, model } = parsed.data;
  const wrong = checkKeyFormat(provider, apiKey);
  if (wrong) return { error: wrong };
  const check = await verifyKey({ provider, apiKey, model: model || null });
  if (!check.ok) return { error: check.message };
  const { repo } = await requireTenant();
  await repo.saveApiKey(provider, apiKey, model || null);
  revalidatePath("/settings");
  return { ok: "Key checked with the provider and saved." };
}

export async function removeKey() {
  const { repo } = await requireTenant();
  await repo.removeApiKey();
  revalidatePath("/settings");
}
