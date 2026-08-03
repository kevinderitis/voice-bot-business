import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { getSetting, setSetting } from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.GEMINI_API_KEY;
const PORT = Number(process.env.PORT || 8787);
const GEMINI_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

if (!API_KEY) {
  console.error(
    '[server] Missing API key. Copy server/.env.example to server/.env and set your key.'
  );
}

process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});

const app = express();
app.use(express.json());

app.get('/api/settings', async (req, res) => {
  try {
    const systemPrompt = (await getSetting('systemPrompt', '')) ?? '';
    res.json({ systemPrompt });
  } catch (err) {
    console.error('[server] GET /api/settings failed:', err.message);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const systemPrompt = String(req.body?.systemPrompt ?? '');
    await setSetting('systemPrompt', systemPrompt);
    res.json({ ok: true, systemPrompt });
  } catch (err) {
    console.error('[server] PUT /api/settings failed:', err.message);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

const clientDist = path.resolve(__dirname, '../client/dist');
const clientIndex = path.join(clientDist, 'index.html');
if (fs.existsSync(clientIndex)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(clientIndex));
} else {
  app.get('/health', (req, res) => res.json({ ok: true }));
  console.log('[server] client/dist not found — run `npm run build` to serve the UI from this server (dev UI runs on Vite).');
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const safeSend = (ws, data) => {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  } catch (err) {
    console.error('[server] send failed:', err.message);
  }
};

const safeClose = (ws, code) => {
  try {
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(code);
  } catch {
    /* noop */
  }
};

wss.on('connection', (clientWs) => {
  let geminiWs = null;
  let clientBuffer = [];
  let realtimeCount = 0;
  console.log('[client] connected');

  const closeGemini = () => {
    safeClose(geminiWs, 1000);
    geminiWs = null;
  };

  const openGemini = () => {
    if (!API_KEY) {
      safeSend(
        clientWs,
        JSON.stringify({
          error: {
            code: 'NO_API_KEY',
            message: 'The server has no API key configured. Create server/.env from .env.example.',
          },
        })
      );
      safeClose(clientWs, 1000);
      return;
    }

    const url = `${GEMINI_WS_URL}?key=${encodeURIComponent(API_KEY)}`;
    geminiWs = new WebSocket(url);

    geminiWs.on('open', () => {
      console.log('[gemini] connected');
      for (const msg of clientBuffer) safeSend(geminiWs, msg);
      clientBuffer = [];
    });

    geminiWs.on('message', (data) => {
      const raw = data.toString();
      console.log(`[gemini] <- ${raw.slice(0, 160)}`);
      safeSend(clientWs, raw);
    });

    geminiWs.on('error', (err) => {
      console.error('[gemini] connection error:', err.message);
      safeSend(
        clientWs,
        JSON.stringify({ error: { code: 'GEMINI_WS_ERROR', message: `Error connecting to the voice service: ${err.message}` } })
      );
    });

    geminiWs.on('close', (code, reason) => {
      const reasonText = reason ? reason.toString() : '';
      console.warn(`[gemini] closed: ${code}${reasonText ? ` — ${reasonText}` : ''}`);
      closeGemini();
      safeSend(
        clientWs,
        JSON.stringify({
          error: {
            code: 'GEMINI_CLOSED',
            message: reasonText ? `The voice service closed the connection: ${reasonText}` : 'The connection with the voice service was closed.',
          },
        })
      );
      safeClose(clientWs, 1000);
    });
  };

  clientWs.on('message', (data) => {
    const raw = data.toString();
    if (raw.startsWith('{"realtimeInput"')) {
      realtimeCount++;
      if (realtimeCount <= 3 || realtimeCount % 50 === 0) {
        console.log(`[client] -> audio chunk #${realtimeCount} (${raw.length} chars)`);
      }
    } else {
      console.log(`[client] -> ${raw.slice(0, 160)}`);
    }
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      safeSend(geminiWs, raw);
    } else {
      clientBuffer.push(raw);
      if (!geminiWs) openGemini();
    }
  });

  clientWs.on('close', () => {
    console.log('[client] closed');
    closeGemini();
    clientBuffer = [];
  });

  clientWs.on('error', () => {
    closeGemini();
  });

  openGemini();
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] WebSocket proxy on ws://localhost:${PORT}/ws`);
});
