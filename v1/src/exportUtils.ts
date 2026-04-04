import type { CanonicalModel, EdgeType, ExportFormat, FlowNode } from './types'

const JSON_EXPORT_CONTRACT = 'flowcraft.export.v1'

type JsonExportEnvelope = {
  contract: typeof JSON_EXPORT_CONTRACT
  schemaVersion: '1.1'
  format: 'json'
  exportedAt: string
  model: CanonicalModel
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function escapeMermaidLabel(value: string) {
  return value.replaceAll('"', '\\"')
}

function edgeArrow(type: EdgeType) {
  if (type === 'parallel') return '==>'
  if (type === 'fallback') return '-.->'
  return '-->'
}

function flowNodeShape(node: FlowNode) {
  const label = escapeMermaidLabel(node.label || node.id)
  if (node.type === 'terminal') return `("${label}")`
  if (node.type === 'decision') return `{"${label}"}`
  if (node.type === 'data') return `[/"${label}"/]`
  if (node.type === 'annotation') return `["${label}"]`
  return `["${label}"]`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCanonicalModelShape(value: unknown): value is CanonicalModel {
  if (!isObject(value)) return false
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return false
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false
  if (!isObject(value.projections)) return false
  const projections = value.projections as Record<string, unknown>
  return isObject(projections.flow) && isObject(projections.map)
}

export function buildJsonExportEnvelope(model: CanonicalModel): JsonExportEnvelope {
  return {
    contract: JSON_EXPORT_CONTRACT,
    schemaVersion: '1.1',
    format: 'json',
    exportedAt: new Date().toISOString(),
    model,
  }
}

export function toJsonExportString(model: CanonicalModel): string {
  return JSON.stringify(buildJsonExportEnvelope(model), null, 2)
}

export function parseJsonImport(rawJson: string): {
  mode: 'lossless' | 'canonical' | 'unknown'
  model: CanonicalModel | null
} {
  const parsed: unknown = JSON.parse(rawJson)
  if (isObject(parsed) && parsed.contract === JSON_EXPORT_CONTRACT && isCanonicalModelShape(parsed.model)) {
    return { mode: 'lossless', model: parsed.model }
  }
  if (isCanonicalModelShape(parsed)) {
    return { mode: 'canonical', model: parsed }
  }
  return { mode: 'unknown', model: null }
}

function stableValue(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((entry) => stableValue(entry))
  if (!isObject(input)) return input
  const sortedKeys = Object.keys(input).sort()
  const out: Record<string, unknown> = {}
  sortedKeys.forEach((key) => {
    out[key] = stableValue(input[key])
  })
  return out
}

export function verifyJsonRoundtripLossless(model: CanonicalModel): { ok: boolean; reason: string } {
  const payload = toJsonExportString(model)
  const parsedPayload = parseJsonImport(payload)
  if (parsedPayload.mode !== 'lossless' || !parsedPayload.model) {
    return { ok: false, reason: 'Could not parse exported JSON contract.' }
  }
  const left = JSON.stringify(stableValue(model))
  const right = JSON.stringify(stableValue(parsedPayload.model))
  if (left !== right) {
    return { ok: false, reason: 'Roundtrip mismatch detected in canonical model structure.' }
  }
  return { ok: true, reason: 'Roundtrip verified.' }
}

export function toMermaidFlowchart(model: CanonicalModel): string {
  const lines: string[] = ['flowchart LR']
  model.nodes.forEach((node) => {
    lines.push(`  ${node.id}${flowNodeShape(node)}`)
  })
  if (model.nodes.length > 0 && model.edges.length > 0) lines.push('')

  model.edges.forEach((edge) => {
    const label = (edge.label ?? '').trim()
    const labelPart = label ? `|${escapeMermaidLabel(label)}|` : ''
    lines.push(`  ${edge.from} ${edgeArrow(edge.type)}${labelPart} ${edge.to}`)
  })
  return `${lines.join('\n')}\n`
}

function edgeStroke(type: EdgeType) {
  if (type === 'conditional') return '#2d6ef5'
  if (type === 'parallel') return '#0f9e6e'
  if (type === 'fallback') return '#e0443a'
  return '#9fa9b9'
}

function actorLabel(actor: FlowNode['actor']) {
  if (!actor) return 'Unassigned'
  return actor.charAt(0).toUpperCase() + actor.slice(1)
}

function nodeSvgShape(node: FlowNode, x: number, y: number, width: number, height: number) {
  const stroke = '#d7dce5'
  const fill = '#ffffff'
  if (node.type === 'terminal') {
    return `<rect x="${x}" y="${y}" rx="28" ry="28" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" />`
  }
  if (node.type === 'decision') {
    const cx = x + width / 2
    const cy = y + height / 2
    return `<polygon points="${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}" fill="${fill}" stroke="${stroke}" />`
  }
  if (node.type === 'data') {
    return `<polygon points="${x + 10},${y} ${x + width},${y} ${x + width - 10},${y + height} ${x},${y + height}" fill="${fill}" stroke="${stroke}" />`
  }
  if (node.type === 'annotation') {
    return `<rect x="${x}" y="${y}" rx="8" ry="8" width="${width}" height="${height}" fill="${fill}" stroke="#8a94a6" stroke-dasharray="5 4" />`
  }
  return `<rect x="${x}" y="${y}" rx="8" ry="8" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" />`
}

export function toSvgSnapshot(model: CanonicalModel, width = 1400, height = 900): string {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]))
  const edgeElements = model.edges
    .map((edge) => {
      const source = nodeById.get(edge.from)
      const target = nodeById.get(edge.to)
      if (!source || !target) return ''
      const stroke = edgeStroke(edge.type)
      const midX = (source.position.x + target.position.x) / 2 + 70
      const midY = (source.position.y + target.position.y) / 2 + 28
      const label = (edge.label ?? '').trim()
      return [
        `<line x1="${source.position.x + 70}" y1="${source.position.y + 28}" x2="${target.position.x + 70}" y2="${target.position.y + 28}" stroke="${stroke}" stroke-width="1.7" ${edge.type === 'fallback' ? 'stroke-dasharray="6 4"' : ''} />`,
        label
          ? `<text x="${midX}" y="${midY - 4}" fill="${stroke}" text-anchor="middle" font-family="DM Sans, Arial, sans-serif" font-size="10" font-weight="600">${escapeXml(label)}</text>`
          : '',
      ].join('')
    })
    .join('')
  const nodeElements = model.nodes
    .map((node) => {
      const x = node.position.x
      const y = node.position.y
      const shape = nodeSvgShape(node, x, y, 140, 56)
      return `${shape}
        <text x="${x + 10}" y="${y + 24}" fill="#1a1d23" font-family="DM Sans, Arial, sans-serif" font-size="12">${escapeXml(node.label)}</text>
        <text x="${x + 10}" y="${y + 42}" fill="#647189" font-family="DM Sans, Arial, sans-serif" font-size="10">${escapeXml(actorLabel(node.actor))}</text>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#f8f9fb"/>
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#9fa9b9" />
        </marker>
      </defs>
      ${edgeElements}
      ${nodeElements}
    </svg>`
}

export async function sha256Hex(input: string | Blob): Promise<string> {
  let bytes: Uint8Array
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input)
  } else {
    bytes = new Uint8Array(await input.arrayBuffer())
  }
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, '0')).join('')
}

export async function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to render SVG as image.'))
      img.src = svgUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context is unavailable.')
    context.fillStyle = '#f8f9fb'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    })
    if (!pngBlob) throw new Error('PNG encoding failed.')
    return pngBlob
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

export function exportMimeType(format: ExportFormat): string {
  if (format === 'json') return 'application/json'
  if (format === 'mermaid') return 'text/plain'
  if (format === 'svg') return 'image/svg+xml'
  return 'image/png'
}
