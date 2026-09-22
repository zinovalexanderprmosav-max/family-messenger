import { z } from 'zod';
const Config = z.object({
  HOST:z.string().default('0.0.0.0'),
  PORT:z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL:z.string().min(1).default('postgres://family:family-dev-only@localhost:5432/family'),
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  APP_VERSION:z.string().min(1).default('0.5.0'),
  OLLAMA_BASE_URL:z.string().url().optional(),
  OLLAMA_MODEL:z.string().min(1).default('qwen3:4b'),
  OPENROUTER_API_KEY:z.string().min(1).optional(),
  OPENROUTER_BASE_URL:z.string().url().default('https://openrouter.ai'),
  OPENROUTER_MODEL:z.string().min(1).default('openrouter/free')
});
export function loadConfig(env:NodeJS.ProcessEnv){
  const p=Config.parse(env);
  return {
    host:p.HOST,port:p.PORT,databaseUrl:p.DATABASE_URL,nodeEnv:p.NODE_ENV,appVersion:p.APP_VERSION,
    ollamaBaseUrl:p.OLLAMA_BASE_URL,ollamaModel:p.OLLAMA_MODEL,
    openRouterApiKey:p.OPENROUTER_API_KEY,openRouterBaseUrl:p.OPENROUTER_BASE_URL,openRouterModel:p.OPENROUTER_MODEL
  };
}
export type AppConfig = ReturnType<typeof loadConfig>;
