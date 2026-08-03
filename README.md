# Voice Bot · Gemini 3.1 Flash Live

Aplicación de voz en tiempo real (voice bot) construida con **React (Vite)** que consume el modelo
**`gemini-3.1-flash-live-preview`** de Google a través de la **Gemini Live API**.

Un repositorio con dos partes:

- **`client/`** — Frontend React con botón push-to-talk, transcripción en vivo, selector de voz e instrucciones de sistema.
- **`server/`** — Proxy WebSocket (Node.js) que guarda tu **API key en el servidor** y reenvía el flujo de audio hacia/desde Gemini.

```
Tú (micrófono) ──► React (client) ── WebSocket ──► Proxy Node (server) ── wss ──► Gemini Live API
                                                  (guarda la API key)
```

## Requisitos

- Node.js 18+
- Una API key de Gemini desde https://aistudio.google.com/app/apikey
  (el modelo `gemini-3.1-flash-live-preview` debe estar habilitado para tu cuenta; es el modelo "Live" de AI Studio).

## Puesta en marcha

```bash
# 1. Instalar dependencias (instala server y client automáticamente)
npm install

# 2. Configurar tu API key
cp .env.example server/.env
#   edita server/.env y pega tu clave en GEMINI_API_KEY

# 3. Arrancar servidor + cliente en modo desarrollo
npm run dev
```

Abre **http://localhost:5173**.

> En modo dev, el proxy queda en `ws://localhost:8787/ws`. El frontend de Vite se conecta a ese puerto
> por defecto (constante `WS_URL` en `client/src/App.jsx`).

## Uso

1. Pulsa **Conectar**.
2. Mantén pulsado el botón central del micrófono mientras hablas y suéltalo para que responda.
3. También puedes **interrumpir** al bot a mitad de respuesta (barge-in) o escribir texto en el campo inferior.

### Voice (voz)

Selecciona la voz entre `Puck`, `Charon`, `Kore`, `Fenrir` y `Aoede`. Cambiar la voz aplica en la próxima sesión.

### Instrucciones del sistema

El área inferior te permite cambiar la personalidad/idioma del bot. Aplica al conectar la próxima sesión.

## Producción

```bash
npm run build   # compila el frontend a client/dist
npm start       # el servidor sirve el frontend y el proxy en http://localhost:8787
```

Abre **http://localhost:8787**. Si quieres HTTPS/WSS (recomendado al publicar), ponlo detrás de un proxy como Caddy/NGINX.

## Seguridad

Tu API key vive únicamente en `server/.env`. El navegador nunca la ve: solo recibe tokens/frases a través del
proxy. Si vas a desplegarlo públicamente, protege el servidor (autenticación, CORS, rate-limit).

## Estructura

```
├── server/                      # Proxy WebSocket + servidor estático
│   ├── index.mjs
│   └── package.json
├── client/                      # Frontend React (Vite)
│   ├── public/
│   │   ├── audio-input.worklet.js    # Micrófono → PCM16 @16kHz
│   │   └── audio-output.worklet.js   # PCM16 @24kHz → altavoces
│   └── src/
│       ├── App.jsx
│       ├── hooks/useLiveSession.js
│       └── lib/geminiLive.js         # Cliente de la Gemini Live API
├── .env.example
└── package.json
```

## Notas técnicas

- **Audio de entrada:** PCM16 mono @ 16 kHz (se re-muestrea desde la frecuencia nativa del micrófono con un AudioWorklet).
- **Audio de salida:** PCM16 mono @ 24 kHz (se re-muestrea hacia la frecuencia de salida del dispositivo).
- **Transcripción:** se activan `inputAudioTranscription` y `outputAudioTranscription` en el `setup` para mostrar
  los subtítulos de ambos lados de la conversación.
- Documentación: https://ai.google.dev/gemini-api/docs/live-api
