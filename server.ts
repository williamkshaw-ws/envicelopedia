import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  const port = process.env.PORT || 3000;

  app.use(express.json());

  // Healthcheck endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  if (!isProduction) {
    // Development mode: Use Vite's development server
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: serve static files from dist
    app.use(express.static(__dirname));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'index.html'));
    });
  }

  app.listen(port, () => {
    console.log(`Server started on port ${port} (Production: ${isProduction})`);
  });
}

startServer();
