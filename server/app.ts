import express from 'express';
import { apiRouter } from './routes.ts';
import { db } from './db.ts';

export function createApiApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use('/api', async (_req, _res, next) => {
    try {
      await db.ready();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', apiRouter);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    if (res.headersSent) return;
    const status = Number(err?.status || err?.statusCode) || 500;
    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : err?.message || 'Request failed',
    });
  });

  return app;
}
