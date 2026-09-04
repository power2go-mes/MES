import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from './server/app.ts';

async function startServer() {
  const app = createApiApp();
  const PORT = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const listen = (port: number) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Power2Go MES listening on http://localhost:${port}`);
    });

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && !process.env.PORT) {
        console.warn(`Port ${port} is in use; trying ${port + 1}.`);
        listen(port + 1);
        return;
      }

      throw error;
    });
  };

  listen(PORT);
}

startServer();
