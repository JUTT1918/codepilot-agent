import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import app from './index.js';

const port = Number(process.env.PORT || 3000);
const host = '0.0.0.0';

async function start() {
  const httpServer = createHttpServer(app);
  if (process.env.NODE_ENV === 'production') {
    const output = resolve(process.cwd(), 'dist');
    const indexPath = resolve(output, 'index.html');
    app.use(express.static(output, { index: false, maxAge: '1h' }));
    app.use((request, response, next) => {
      if (request.method === 'GET' && !request.path.startsWith('/api/') && existsSync(indexPath)) {
        response.sendFile(indexPath);
        return;
      }
      next();
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      configFile: resolve(process.cwd(), 'vite.config.ts'),
      appType: 'spa',
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
        host,
        port,
      },
    });
    app.use(vite.middlewares);
    const close = async () => {
      await vite.close();
      httpServer.close();
    };
    process.once('SIGINT', () => { void close(); });
    process.once('SIGTERM', () => { void close(); });
  }

  httpServer.listen(port, host, () => {
    console.log(`Codepilot listening on ${host}:${port}`);
  });
}

void start().catch((error: unknown) => {
  console.error('Codepilot failed to start.');
  if (process.env.NODE_ENV !== 'production') console.error(error);
  process.exit(1);
});
