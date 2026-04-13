import { Router } from 'express';
import { pingDb } from '../db/client.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const dbOk = await pingDb();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'down',
    ts: new Date().toISOString(),
  });
});
