import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

type GeminiAssistMode = 'toc_seed' | 'detail_steps' | 'ocr_cleanup'

type GeminiAssistRequest = {
  source?: string
  mode?: GeminiAssistMode
  model?: string
}

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large.'))
      }
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function geminiInstruction(mode: GeminiAssistMode): string {
  if (mode === 'toc_seed') {
    return [
      'Extract top-level clusters from this input.',
      'Return ONLY lines in this exact format:',
      'Cluster: <cluster name>',
      'No bullets, numbering, markdown, or commentary.',
    ].join('\n')
  }
  if (mode === 'ocr_cleanup') {
    return [
      'Clean OCR noise while preserving original meaning.',
      'Return plain text only.',
      'Fix line wraps and hyphenation artifacts.',
    ].join('\n')
  }
  return [
    'Convert the input into concise process-step lines for map import.',
    'Return plain text lines only.',
    'Prefer: Start:, Decision:, and End: when appropriate.',
  ].join('\n')
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(payload))
}

async function handleGeminiAssist(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed. Use POST.' })
    return
  }

  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_TOKEN || ''
  if (!apiKey) {
    sendJson(response, 500, {
      error:
        'Server Gemini key missing. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in the server environment.',
    })
    return
  }

  let payload: GeminiAssistRequest
  try {
    const rawBody = await readRequestBody(request)
    payload = JSON.parse(rawBody) as GeminiAssistRequest
  } catch {
    sendJson(response, 400, { error: 'Invalid JSON request body.' })
    return
  }

  const source = (payload.source ?? '').trim()
  if (!source) {
    sendJson(response, 400, { error: 'Missing source text.' })
    return
  }
  const mode: GeminiAssistMode =
    payload.mode === 'toc_seed' || payload.mode === 'detail_steps' || payload.mode === 'ocr_cleanup'
      ? payload.mode
      : 'detail_steps'
  const model = (payload.model ?? '').trim() || GEMINI_DEFAULT_MODEL

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: geminiInstruction(mode) }] },
          contents: [{ role: 'user', parts: [{ text: source }] }],
          generationConfig: {
            temperature: 0.2,
            topP: 0.9,
            maxOutputTokens: 2048,
          },
        }),
      },
    )

    if (!upstream.ok) {
      const detail = await upstream.text()
      sendJson(response, upstream.status, {
        error: `Gemini request failed (${upstream.status}). ${detail.slice(0, 220)}`,
      })
      return
    }

    const data = (await upstream.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text =
      data.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('\n')
        .trim() ?? ''
    if (!text) {
      sendJson(response, 502, { error: 'Gemini returned empty content.' })
      return
    }

    sendJson(response, 200, { text })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini proxy request failed.'
    sendJson(response, 500, { error: message })
  }
}

function geminiProxyPlugin() {
  const route = '/api/gemini/assist'
  return {
    name: 'flowcraft-gemini-proxy',
    configureServer(server: { middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void } }) {
      server.middlewares.use(route, (req, res) => {
        void handleGeminiAssist(req, res)
      })
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void } }) {
      server.middlewares.use(route, (req, res) => {
        void handleGeminiAssist(req, res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), geminiProxyPlugin()],
  server: {
    // Allow cloud preview hosts used by remote dev environments.
    allowedHosts: true,
    port: 5177,
    strictPort: true,
  },
})
