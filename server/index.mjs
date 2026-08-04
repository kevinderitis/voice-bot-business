import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { getSetting, setSetting } from './store.mjs';
import {
  functionDeclarations,
  executeFunction,
  seedAvailability,
  getAvailabilityRange,
  setAvailability,
  getReservations,
  deleteReservation,
  ROOM_TYPES,
  todayKey,
} from './reservations.mjs';
import { getDb, isMongoConfigured } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

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

// ---- Admin auth ----
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';
const adminTokens = new Map();

const readCookie = (req, name) => {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
};

const requireAdmin = (req, res, next) => {
  const token = readCookie(req, 'admin_token');
  if (token && adminTokens.has(token)) return next();
  return res.status(401).json({ error: 'No autorizado' });
};

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = crypto.randomUUID();
    adminTokens.set(token, String(username));
    res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Credenciales inválidas' });
});

app.post('/api/logout', (req, res) => {
  const token = readCookie(req, 'admin_token');
  if (token) adminTokens.delete(token);
  res.setHeader('Set-Cookie', 'admin_token=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ---- Admin: availability ----
app.get('/api/admin/availability', requireAdmin, async (req, res) => {
  try {
    const roomType = req.query.roomType === 'dorm' ? 'dorm' : 'private';
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 730);
    const from = String(req.query.from || todayKey());
    const list = await getAvailabilityRange(roomType, from, days);
    res.json({ roomType, from, list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/availability', requireAdmin, async (req, res) => {
  try {
    const { roomType, date, available } = req.body || {};
    if (!ROOM_TYPES.includes(roomType)) return res.status(400).json({ error: 'roomType inválido' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'fecha inválida' });
    await setAvailability(roomType, date, Boolean(available));
    res.json({ ok: true, roomType, date, available: Boolean(available) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Admin: reservations ----
app.get('/api/admin/reservations', requireAdmin, async (req, res) => {
  try {
    const reservations = await getReservations();
    res.json({ reservations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/reservations/:id', requireAdmin, async (req, res) => {
  try {
    await deleteReservation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Admin static page ----
const adminDir = path.join(__dirname, 'admin');
if (fs.existsSync(path.join(adminDir, 'index.html'))) {
  app.use('/admin', express.static(adminDir));
  app.get('/admin', (req, res) => res.sendFile(path.join(adminDir, 'index.html')));
}

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

    geminiWs.on('message', async (data) => {
      const raw = data.toString();
      console.log(`[gemini] <- ${raw.slice(0, 160)}`);
      let handled = false;
      try {
        const msg = JSON.parse(raw);
        if (msg.toolCall && Array.isArray(msg.toolCall.functionCalls) && msg.toolCall.functionCalls.length) {
          const functionResponses = [];
          for (const fc of msg.toolCall.functionCalls) {
            console.log(`[gemini] tool call: ${fc.name}`, JSON.stringify(fc.args || {}).slice(0, 200));
            try {
              const response = await executeFunction(fc.name, fc.args || {});
              functionResponses.push({ id: fc.id, name: fc.name, response });
            } catch (err) {
              functionResponses.push({ id: fc.id, name: fc.name, response: { error: err.message || 'La función falló' } });
            }
          }
          safeSend(geminiWs, JSON.stringify({ toolCall: { functionResponses } }));
          handled = true;
        } else if (msg.toolCallCancellation) {
          console.log(`[gemini] tool calls cancelled: ${(msg.toolCallCancellation.ids || []).join(', ')}`);
          handled = true;
        }
      } catch (err) {
        console.error('[server] parse gemini message:', err.message);
      }
      if (!handled) safeSend(clientWs, raw);
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
    let toSend = raw;
    if (raw.startsWith('{"setup"')) {
      try {
        const msg = JSON.parse(raw);
        if (msg.setup && !msg.setup.tools) {
          msg.setup.tools = [{ functionDeclarations: functionDeclarations() }];
        }
        toSend = JSON.stringify(msg);
      } catch (err) {
        console.error('[server] parse client setup:', err.message);
      }
    }

    if (toSend.startsWith('{"realtimeInput"')) {
      realtimeCount++;
      if (realtimeCount <= 3 || realtimeCount % 50 === 0) {
        console.log(`[client] -> audio chunk #${realtimeCount} (${toSend.length} chars)`);
      }
    } else {
      console.log(`[client] -> ${toSend.slice(0, 160)}`);
    }
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      safeSend(geminiWs, toSend);
    } else {
      clientBuffer.push(toSend);
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

  if (isMongoConfigured()) {
    seedAvailability()
      .then((n) => console.log(`[server] Disponibilidad sembrada/actualizada (${n})`))
      .catch((err) => console.error('[server] No se pudo sembrar disponibilidad:', err.message));
  } else {
    console.warn('[server] MONGODB_URI no configurada — reservas y disponibilidad desactivadas (solo settings en JSON).');
  }
});
