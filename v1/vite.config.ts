import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

type GeminiAssistMode = 'toc_seed' | 'detail_steps' | 'ocr_cleanup'

type GeminiAssistRequest = {
  source?: string
  mode?: GeminiAssistMode
  model?: string
}

type GeminiStructuredStepKind = 'process' | 'decision' | 'fact' | 'policy' | 'unclassified'

type GeminiStructuredStep = {
  kind: GeminiStructuredStepKind
  title: string
  notes: string
  confidence: number | null
}

type GeminiStructuredSection = {
  title: string
  clusterHint?: string
  steps: GeminiStructuredStep[]
}

type GeminiStructuredPayload = {
  schemaVersion: 'import-model-v2'
  clusters: string[]
  sections: GeminiStructuredSection[]
  cleanedText: string
  warnings: string[]
}

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
const STRUCTURED_SCHEMA_VERSION = 'import-model-v2'

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
      'Return STRICT JSON only.',
      'Schema:',
      '{"schemaVersion":"import-model-v2","clusters":["Cluster A"],"warnings":[]}',
      'Rules:',
      '- clusters must be unique',
      '- no markdown, no commentary',
    ].join('\n')
  }
  if (mode === 'ocr_cleanup') {
    return [
      'Clean OCR noise while preserving original meaning.',
      'Return STRICT JSON only.',
      'Schema:',
      '{"schemaVersion":"import-model-v2","cleanedText":"...","warnings":[]}',
      'Fix line wraps and hyphenation artifacts.',
    ].join('\n')
  }
  return [
    'Convert the input into hierarchical import data.',
    'Return STRICT JSON only.',
    'Schema:',
    '{"schemaVersion":"import-model-v2","sections":[{"title":"Section","clusterHint":"Optional","steps":[{"kind":"process|decision|fact|policy|unclassified","title":"Short title","notes":"Optional notes","confidence":0.0}]}],"warnings":[]}',
    'Rules:',
    '- keep titles concise',
    '- classify non-procedural statements as fact or policy',
    '- do not output markdown',
  ].join('\n')
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(payload))
}

function uniqueStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

function extractJsonCandidate(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]+?)```/i) ?? text.match(/```\s*([\s\S]+?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  return text.trim()
}

function toStepKind(value: unknown): GeminiStructuredStepKind {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (
    kind === 'process' ||
    kind === 'decision' ||
    kind === 'fact' ||
    kind === 'policy' ||
    kind === 'unclassified'
  ) {
    return kind
  }
  return 'process'
}

function normalizeTextLine(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeStructuredPayload(
  mode: GeminiAssistMode,
  rawText: string,
): { text: string; structured: GeminiStructuredPayload; warnings: string[] } {
  const warnings: string[] = []
  const candidate = extractJsonCandidate(rawText)
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(candidate) as Record<string, unknown>
  } catch {
    warnings.push('Gemini returned non-JSON output; applied fallback normalization.')
  }

  if (mode === 'toc_seed') {
    const clustersFromJson = uniqueStrings(parsed.clusters)
    const clustersFromText = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[-*]\s*/, ''))
      .map((line) => {
        const match = line.match(/^cluster\s*:\s*(.+)$/i)
        return match ? match[1].trim() : ''
      })
      .filter(Boolean)
    const clusters = uniqueStrings(clustersFromJson.length > 0 ? clustersFromJson : clustersFromText)
    const text = clusters.map((cluster) => `Cluster: ${cluster}`).join('\n')
    return {
      text,
      warnings,
      structured: {
        schemaVersion: STRUCTURED_SCHEMA_VERSION,
        clusters,
        sections: [],
        cleanedText: '',
        warnings: [...warnings, ...uniqueStrings(parsed.warnings)],
      },
    }
  }

  if (mode === 'ocr_cleanup') {
    const cleanedText = normalizeTextLine(parsed.cleanedText) || rawText.trim()
    return {
      text: cleanedText,
      warnings,
      structured: {
        schemaVersion: STRUCTURED_SCHEMA_VERSION,
        clusters: [],
        sections: [],
        cleanedText,
        warnings: [...warnings, ...uniqueStrings(parsed.warnings)],
      },
    }
  }

  const rawSections = Array.isArray(parsed.sections) ? parsed.sections : []
  const normalizedSections = rawSections
    .map((section) => {
      if (!section || typeof section !== 'object') return null
      const item = section as Record<string, unknown>
      const title = normalizeTextLine(item.title) || 'Imported Section'
      const clusterHint = normalizeTextLine(item.clusterHint) || undefined
      const steps = (Array.isArray(item.steps) ? item.steps : [])
        .map((step) => {
          if (!step || typeof step !== 'object') return null
          const rawStep = step as Record<string, unknown>
          const stepTitle = normalizeTextLine(rawStep.title)
          if (!stepTitle) return null
          const notes = normalizeTextLine(rawStep.notes)
          const confidenceRaw =
            typeof rawStep.confidence === 'number' && !Number.isNaN(rawStep.confidence)
              ? Math.max(0, Math.min(1, rawStep.confidence))
              : null
          return {
            kind: toStepKind(rawStep.kind),
            title: stepTitle,
            notes,
            confidence: confidenceRaw,
          } satisfies GeminiStructuredStep
        })
        .filter((step): step is GeminiStructuredStep => step !== null)
      if (steps.length === 0) return null
      return clusterHint ? { title, clusterHint, steps } : { title, steps }
    })
    .filter((section): section is GeminiStructuredSection => section !== null)

  if (normalizedSections.length === 0) {
    const fallbackLines = rawText
      .split(/\r?\n/)
      .map((line) => normalizeTextLine(line))
      .filter(Boolean)
      .slice(0, 80)
    if (fallbackLines.length > 0) {
      warnings.push('Structured sections missing; mapped plain text into fallback section.')
      normalizedSections.push({
        title: 'Imported Detail',
        steps: fallbackLines.map((line) => ({
          kind: /^(decision:|if |when )/i.test(line) || line.includes('?') ? 'decision' : 'process',
          title: line,
          notes: '',
          confidence: null,
        })),
      })
    }
  }

  const text = normalizedSections
    .flatMap((section) => [
      `# ${section.title}`,
      ...section.steps.map((step) => {
        const prefix = `[${step.kind}]`
        return step.notes ? `${prefix} ${step.title}; ${step.notes}` : `${prefix} ${step.title}`
      }),
    ])
    .join('\n')
    .trim()

  return {
    text,
    warnings,
    structured: {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      clusters: uniqueStrings(parsed.clusters),
      sections: normalizedSections,
      cleanedText: '',
      warnings: [...warnings, ...uniqueStrings(parsed.warnings)],
    },
  }
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
            responseMimeType: mode === 'ocr_cleanup' ? 'text/plain' : 'application/json',
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

    const normalized = normalizeStructuredPayload(mode, text)
    sendJson(response, 200, {
      mode,
      text: normalized.text,
      warnings: normalized.warnings,
      structured: normalized.structured,
    })
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
