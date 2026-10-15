import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

interface MinimalRes {
  headersSent: boolean;
  writeHead(code: number, headers: Record<string, string>): unknown;
  end(body: string): unknown;
}

interface MinimalProxy {
  on(ev: 'error', cb: (err: unknown, req: unknown, res: MinimalRes) => void): unknown;
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        // Backend is optional: when it is down, answer 503 quietly instead of logging an error per health poll.
        configure: (server: unknown) => {
          (server as MinimalProxy).on('error', (_err, _req, res) => {
            if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end('{"detail":"backend offline"}');
          });
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
