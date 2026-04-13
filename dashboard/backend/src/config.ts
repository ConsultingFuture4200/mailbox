import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ path: process.env.ENV_FILE ?? '/app/.env' });

const schema = z.object({
  DATABASE_URL: z.string().url().or(z.string().regex(/^postgres(ql)?:\/\//)),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().min(1),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(3000),
  ANTHROPIC_API_KEY: z.string().optional(),
  OLLAMA_URL: z.string().url().default('http://ollama:11434'),
  QDRANT_URL: z.string().url().default('http://qdrant:6333'),
  N8N_URL: z.string().url().default('http://n8n:5678'),
  ROUTING_LOCAL_CONFIDENCE_FLOOR: z.coerce.number().min(0).max(1).default(0.75),
  NODE_ENV: z.enum(['development', 'production']).default('production'),
});

export const config = schema.parse(process.env);
