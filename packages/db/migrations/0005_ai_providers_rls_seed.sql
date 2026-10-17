-- Platform-wide AI provider settings (ADR 0012). Not tenant data: readable by the runtime
-- role, writable only under withPlatformAccess() (which is audited).
ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_providers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ai_providers_read" ON "ai_providers" FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY "ai_providers_write" ON "ai_providers" FOR ALL
  USING (app_platform_access()) WITH CHECK (app_platform_access());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_providers" TO voicedesk_app;
--> statement-breakpoint
SELECT set_config('app.platform_access', 'on', true);
--> statement-breakpoint
INSERT INTO "ai_providers" ("key", "kind", "name", "base_url", "enabled", "priority", "models", "options", "notes")
VALUES
  ('anthropic', 'anthropic', 'Claude (Anthropic)', NULL, false, 1,
   '{"realtime":"claude-haiku-5-5","reasoning":"claude-sonnet-5-5"}',
   '{"thinking":{"realtime":false,"reasoning":true},"thinkingControl":"none","structuredOutput":"json_schema","timeoutMs":120000,"pricing":{"inputPerM":0,"outputPerM":0}}',
   'Uses the key saved here, or ANTHROPIC_API_KEY from .env. Costs are priced per model automatically.'),
  ('deepseek', 'openai_compatible', 'DeepSeek', 'https://api.deepseek.com', false, 2,
   '{"realtime":"deepseek-flash","reasoning":"deepseek-flash"}',
   '{"thinking":{"realtime":false,"reasoning":true},"thinkingControl":"deepseek","structuredOutput":"json_object","timeoutMs":120000,"pricing":{"inputPerM":0.15,"outputPerM":0.6,"cachedInputPerM":0.003}}',
   'DeepSeek processes data in China. Fine for testing with demo data; real customer data needs a UK GDPR international transfer assessment first.'),
  ('local', 'openai_compatible', 'Local model', 'http://localhost:11434/v1', false, 3,
   '{"realtime":"qwen3.6-35b-a3b","reasoning":"qwen3.6-35b-a3b"}',
   '{"thinking":{"realtime":false,"reasoning":false},"thinkingControl":"reasoning_effort","structuredOutput":"json_schema","timeoutMs":300000,"pricing":{"inputPerM":0,"outputPerM":0}}',
   'Any OpenAI-compatible server on this machine (Ollama, LM Studio, llama.cpp…). Free and private, but usually too slow for phone calls.')
ON CONFLICT ("key") DO NOTHING;
