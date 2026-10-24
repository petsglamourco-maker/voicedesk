---
id: platform-ai-providers
title: Platform admin - AI providers
page: /platform/ai
roles: platform
keywords: ai providers, claude, anthropic, deepseek, local model, ollama, lm studio, api key, fallback, priority, model, test connection, mock
suggested: How do I switch on Claude or DeepSeek? | What happens if a provider fails? | Why is the assistant using the offline mock?
---

## What this page does

**Platform admin → AI providers** chooses which AI models power VoiceDesk for every business. Only the platform owner can see it; open it from the account menu (**Platform admin**).

Three providers are listed: Claude, DeepSeek and a local model (any OpenAI-compatible server, such as Ollama or LM Studio). Switched-on providers are tried in order; if one fails, the next takes over. Changes apply within about 10 seconds.

The top of the page shows **In use, in order** with the active providers. If it says "No AI provider is switched on and ready", the assistant uses an offline mock that gives canned answers, and profile generation and Ask VoiceDesk won't work properly.

## Switching a provider on

1. Paste the provider's key into **API key** and click **Save key**. The key is stored encrypted and only a short hint is shown afterwards. For Claude, you can instead leave ANTHROPIC_API_KEY in `.env`, shown as "Using ANTHROPIC_API_KEY from .env".
2. Check the **Model for live conversations** and **Model for background work (profiles, summaries)**, and click **Save** if you changed anything.
3. Click **Test connection**. A successful test shows the time taken and whether tools worked.
4. Switch the provider **On**. The switch takes effect straight away.

If you see "SETTINGS_ENCRYPTION_KEY is missing from .env", add that setting (32 random bytes, base64), restart VoiceDesk and try again.

## Order and fallback

Use **Move up** and **Move down** to set the order. The first ready provider handles every request; the next one is used only if it fails.

## Local models

For a local model, enter the **Server URL (OpenAI-compatible, usually ends in /v1)**, click **Find models**, and choose the models. **API key** is not needed for most local servers. The server needs a context window of at least 16,000 tokens; Ollama's default of 4,096 silently cuts the assistant's instructions. **Test connection** warns about this. Local models are fine for experiments but usually too slow for phone calls.

## Advanced settings

Under **Advanced** you can let the model think during live conversations (slower) or background work, set **Input price, $ per million tokens** and **Output price, $ per million tokens** (used to estimate costs), and change the **Timeout (seconds)**.

## Privacy warning about DeepSeek

DeepSeek processes data in China. Only use it with demo data until a UK GDPR international transfer assessment has been done. For real customers, put Claude first or switch DeepSeek off.

## Costs

Every AI reply costs a small amount at the provider. The Test console shows an estimated cost for each reply. Keep an eye on spending in the provider's own console as well.
