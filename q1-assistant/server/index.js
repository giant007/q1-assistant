import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { getDb } from './db.js';
import { logger } from './logger.js';
import { errorMiddleware } from './http.js';
import clientsRoute from './routes/clients.js';
import meRoute from './routes/me.js';
import identityRoute from './routes/identity.js';
import documentsRoute from './routes/documents.js';
import chatRoute from './routes/chat.js';
import { ingest } from './services/ingest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
getDb();
ingest();

const app = express();
app.use(express.json());
app.use(express.static(path.join(root, 'public'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));
app.use('/api', clientsRoute, meRoute, identityRoute, documentsRoute, chatRoute);
app.use(errorMiddleware);

const server = app.listen(config.port, () => {
  logger.info(`项目资料助手已启动 http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
