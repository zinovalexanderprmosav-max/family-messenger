import { z } from 'zod';
const Config = z.object({
  HOST:z.string().default('0.0.0.0'),
  PORT:z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL:z.string().min(1).default('postgres://family:family-dev-only@localhost:5432/family'),
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  APP_VERSION:z.string().min(1).default('0.4.0-final')
});
export function loadConfig(env:NodeJS.ProcessEnv){
  const p=Config.parse(env);
  return {host:p.HOST,port:p.PORT,databaseUrl:p.DATABASE_URL,nodeEnv:p.NODE_ENV,appVersion:p.APP_VERSION};
}
export type AppConfig = ReturnType<typeof loadConfig>;
