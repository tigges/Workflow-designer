import { create } from 'zustand'
import { seedState } from './data/defaultData'
import type {
  AppState,
  Actor,
  CanonicalModel,
  ConfidenceSummary,
  EdgeModel,
  EdgeType,
  ExportArtifact,
  FlowEdge,
  FlowNode,
  FlowNodeType,
  ImportDocumentMap,
  ImportDocumentMapBundle,
  Origin,
  PMStore,
  ReviewState,
  ValidationResult,
  ViewTab,
  XY,
} from './types'
import { parseJsonImport } from './exportUtils'

const STORAGE_KEY = 'processmap-v1-store'

const now = () => new Date().toISOString()
const mkId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function persist(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function hydrate(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AppState
    parsed.artifacts.forEach((artifact) => {
      artifact.versions = artifact.versions.map((version) => ({
        ...version,
        reviewAudit: Array.isArray((version as { reviewAudit?: unknown }).reviewAudit)
          ? (version as { reviewAudit: typeof version.reviewAudit }).reviewAudit
          : [],
        exportArtifacts: Array.isArray((version as { exportArtifacts?: unknown }).exportArtifacts)
          ? (version as { exportArtifacts: typeof version.exportArtifacts }).exportArtifacts
          : [],
      }))
    })
    return parsed
  } catch {
    return null
  }
}

function validate(model: CanonicalModel) {
  const issues: CanonicalModel['validation'] = []

  if (model.nodes.length > 0 && !model.nodes.some((n) => n.type === 'terminal')) {
    issues.push({
      code: 'NO_TERMINAL',
      severity: 'warn',
      message: 'No terminal node found.',
    })
  }

  model.nodes
    .filter((n) => n.type === 'decision')
    .forEach((decision) => {
      const exits = model.edges.filter((e) => e.from === decision.id)
      if (exits.length < 2) {
        issues.push({
          code: 'DECISION_NEEDS_EXITS',
          severity: 'error',
          message: `Decision "${decision.label}" needs at least 2 exits.`,
          targetId: decision.id,
        })
      }
    })

  model.nodes.forEach((node) => {
    const linked = model.edges.some((e) => e.from === node.id || e.to === node.id)
    if (!linked && node.type !== 'annotation') {
      issues.push({
        code: 'ISOLATED_NODE',
        severity: 'warn',
        message: `Node "${node.label}" is isolated.`,
        targetId: node.id,
      })
    }
  })

  model.edges
    .filter((e) => e.type === 'conditional' && !e.label?.trim())
    .forEach((edge) => {
      issues.push({
        code: 'UNLABELED_CONDITIONAL',
        severity: 'warn',
        message: 'Conditional edge is missing label.',
        targetId: edge.id,
      })
    })

  model.validation = issues
  model.confidence.validationPenalty = Number(
    (issues.filter((i) => i.severity !== 'info').length * 0.03).toFixed(2),
  )
  model.confidence.overall = Math.max(
    0,
    Number((model.confidence.extraction + model.confidence.synthesis - model.confidence.validationPenalty).toFixed(2)),
  )
}

function defaultConfidence(): ConfidenceSummary {
  return { overall: 1, extraction: 1, synthesis: 1, validationPenalty: 0 }
}

function emptyModel(title: string): CanonicalModel {
  return {
    id: mkId('model'),
    title,
    sourceDocs: [],
    nodes: [],
    edges: [],
    confidence: defaultConfidence(),
    validation: [],
    projections: {
      flow: { nodePositions: {} },
      map: { nodePositions: {} },
    },
  }
}

function actorFromText(text: string): Actor {
  const lower = text.toLowerCase()
  if (
    lower.includes('customer') ||
    lower.includes('user') ||
    lower.includes('client') ||
    lower.includes('player')
  ) {
    return 'customer'
  }
  if (
    lower.includes('agent') ||
    lower.includes('support') ||
    lower.includes('advisor') ||
    lower.includes('finance') ||
    lower.includes('cashier') ||
    lower.includes('kyc')
  ) {
    return 'agent'
  }
  if (lower.includes('system') || lower.includes('service') || lower.includes('backend')) return 'system'
  if (lower.includes('manager') || lower.includes('supervisor') || lower.includes('lead')) return 'manager'
  if (lower.includes('partner') || lower.includes('vendor') || lower.includes('external')) return 'external'
  return ''
}

function inferNodeTypeFromText(text: string): FlowNodeType {
  const lower = text.toLowerCase()
  if (
    lower.startsWith('start') ||
    lower.startsWith('begin') ||
    lower.startsWith('end') ||
    lower.startsWith('close')
  ) {
    return 'terminal'
  }
  if (lower.includes('?') || lower.startsWith('if ') || lower.includes('decision')) return 'decision'
  if (
    lower.includes('system') ||
    lower.includes('database') ||
    lower.includes('crm') ||
    lower.includes('api') ||
    lower.includes('service')
  ) {
    return 'data'
  }
  if (lower.startsWith('note:') || lower.startsWith('annotation:')) return 'annotation'
  return 'process'
}

function mapStage(index: number, total: number): string {
  const phases = ['Discover', 'Consider', 'Onboard', 'Use', 'Resolve', 'Retain']
  if (total <= 1) return phases[0]
  const ratio = index / Math.max(1, total - 1)
  return phases[Math.min(phases.length - 1, Math.floor(ratio * phases.length))]
}

function detectParallelLabel(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes('parallel') || lower.includes('in parallel') || lower.includes('simultaneous')
}

function inferEdgeTypeForImported(source: FlowNode, target: FlowNode): EdgeType {
  if (source.type === 'decision') return 'conditional'
  if (target.type === 'annotation') return 'fallback'
  if (source.type === 'data' || target.type === 'data') return 'parallel'
  return 'sequential'
}

function normalizeEdgeType(value: string): EdgeType {
  if (value === 'sequential' || value === 'conditional' || value === 'parallel' || value === 'fallback') {
    return value
  }
  return 'sequential'
}

function normalizeReviewState(state: string): ReviewState {
  if (state === 'draft' || state === 'in_review' || state === 'approved' || state === 'rejected') return state
  return 'draft'
}

function normalizeConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(0, Math.min(1, Number(value.toFixed(2))))
}

type ImportLineKind = 'heading' | 'process' | 'decision' | 'fact' | 'policy' | 'unclassified' | 'skip'

type ParsedImportStep = {
  kind: Exclude<ImportLineKind, 'heading' | 'skip'>
  title: string
  notes: string
}

type ParsedImportSection = {
  title: string
  steps: ParsedImportStep[]
}

type ImportBudgets = {
  maxInputLines: number
  maxProcessNodes: number
  maxAnnotationNodes: number
  maxTotalNodes: number
  maxEdges: number
  maxChildrenPerSection: number
  maxTitleChars: number
  maxNotesChars: number
}

const IMPORT_BUDGETS: ImportBudgets = {
  maxInputLines: 600,
  maxProcessNodes: 72,
  maxAnnotationNodes: 24,
  maxTotalNodes: 96,
  maxEdges: 120,
  maxChildrenPerSection: 12,
  maxTitleChars: 72,
  maxNotesChars: 280,
}

const NOISE_LINE_RE = /^(?:[-_=*#~\s]{4,}|page\s+\d+|\d+\s*\/\s*\d+|https?:\/\/\S+|www\.\S+)$/i
const PAGE_MARKER_RE = /^--\s*\d+\s*(?:of|\/)\s*\d+\s*--$/i
const HEADER_RE = /^(?:#{1,3}\s+.+|\d+(?:\.\d+)*\s+[A-Z].+|[A-Z][A-Z\s&/-]{8,})$/
const BULLET_RE = /^[-*•]\s+/
const NUMBERING_RE = /^(?:\d+[\).]|[a-z]\)|[ivx]+\.)\s+/i
const DECISION_RE = /^(?:decision:|if |when |is |are |does |should |can |will |check |verify |confirm )/i
const ACTION_RE =
  /^(?:start:|end:|open |close |submit |check |review |verify |validate |escalate |inform |guide |cancel |update |create |send |resolve |process )/i
const POLICY_RE =
  /\b(?:policy|must|should|required|requirement|cannot|never|within|business day|sla|rule|mandatory)\b/i
const FACT_RE =
  /^(?:fact:|context:|background:|definition:|note:|statement:)|\b(?:means|defined as|refers to|currently|baseline|kpi)\b/i

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function clampText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const boundary = value.lastIndexOf(' ', maxChars - 1)
  const end = boundary > 20 ? boundary : maxChars
  return `${value.slice(0, end).trim()}...`
}

function stripLineMarkers(line: string): string {
  return line.replace(BULLET_RE, '').replace(NUMBERING_RE, '').trim()
}

function splitTitleAndNotes(line: string, budgets: ImportBudgets): { title: string; notes: string } {
  const withoutMarkers = stripLineMarkers(line)
  const explicitTagMatch = withoutMarkers.match(/^\[(process|decision|fact|policy|unclassified)\]\s*(.+)$/i)
  const normalized = normalizeLine(explicitTagMatch ? explicitTagMatch[2] : withoutMarkers)
  const byDelimiter = normalized.match(/^(.{8,120}?)(?:\s*[;:]\s+|\s+[-–—]\s+)(.+)$/)
  let title = byDelimiter ? byDelimiter[1].trim() : normalized
  let notes = byDelimiter ? byDelimiter[2].trim() : ''

  if (title.length > budgets.maxTitleChars) {
    const compactTitle = clampText(title, budgets.maxTitleChars)
    const overflow = title.slice(compactTitle.replace(/\.\.\.$/, '').length).trim()
    title = compactTitle
    notes = [overflow, notes].filter(Boolean).join(' ')
  }

  if (!title) title = 'Imported step'
  notes = clampText(notes, budgets.maxNotesChars)
  return { title, notes }
}

function classifyImportLine(rawLine: string): { kind: ImportLineKind; text: string } {
  const cleaned = normalizeLine(rawLine)
  if (!cleaned) return { kind: 'skip', text: '' }
  if (NOISE_LINE_RE.test(cleaned) || PAGE_MARKER_RE.test(cleaned)) return { kind: 'skip', text: '' }
  const tagged = cleaned.match(/^\[(process|decision|fact|policy|unclassified)\]\s*(.+)$/i)
  if (tagged) {
    return {
      kind: tagged[1].toLowerCase() as ParsedImportStep['kind'],
      text: tagged[2].trim(),
    }
  }
  if (HEADER_RE.test(cleaned)) return { kind: 'heading', text: stripLineMarkers(cleaned) }
  if (DECISION_RE.test(cleaned) || cleaned.includes('?')) return { kind: 'decision', text: cleaned }
  if (POLICY_RE.test(cleaned)) return { kind: 'policy', text: cleaned }
  if (FACT_RE.test(cleaned)) return { kind: 'fact', text: cleaned }
  if (ACTION_RE.test(cleaned)) return { kind: 'process', text: cleaned }
  if (cleaned.length < 8) return { kind: 'unclassified', text: cleaned }
  return { kind: 'process', text: cleaned }
}

function parseSectionsFromText(text: string, budgets: ImportBudgets): {
  sections: ParsedImportSection[]
  warnings: string[]
} {
  const normalizedInput = text.replace(/\r\n?/g, '\n')
  const rawLines = normalizedInput.split('\n')
  const warnings: string[] = []
  const limitedLines = rawLines.slice(0, budgets.maxInputLines)
  if (rawLines.length > budgets.maxInputLines) {
    warnings.push(`Input clipped to ${budgets.maxInputLines} lines.`)
  }
  const sections: ParsedImportSection[] = [{ title: 'General', steps: [] }]
  let activeSection = sections[0]

  for (const rawLine of limitedLines) {
    const classified = classifyImportLine(rawLine)
    if (classified.kind === 'skip') continue
    if (classified.kind === 'heading') {
      const headingTitle = splitTitleAndNotes(classified.text, budgets).title
      activeSection = {
        title: headingTitle || 'Section',
        steps: [],
      }
      sections.push(activeSection)
      continue
    }
    if (activeSection.steps.length >= budgets.maxChildrenPerSection) {
      warnings.push(`Section "${activeSection.title}" clipped to ${budgets.maxChildrenPerSection} steps.`)
      continue
    }
    const { title, notes } = splitTitleAndNotes(classified.text, budgets)
    activeSection.steps.push({
      kind: classified.kind,
      title,
      notes,
    })
  }

  const filtered = sections.filter((section) => section.steps.length > 0)
  return { sections: filtered.length > 0 ? filtered : [{ title: 'General', steps: [] }], warnings }
}

function buildModelFromSections(
  sections: ParsedImportSection[],
  options: {
    origin: Origin
    title: string
    confidence: ConfidenceSummary
    budgets: ImportBudgets
    warnings: string[]
  },
): CanonicalModel {
  const { origin, title, confidence, budgets, warnings } = options
  const model = emptyModel(title)
  model.confidence = confidence
  const processNodes: FlowNode[] = []
  const annotationNodes: FlowNode[] = []

  sections.forEach((section) => {
    const sectionTitle = section.title === 'General' ? '' : section.title
    const processCandidates = section.steps.filter((step) => step.kind === 'process' || step.kind === 'decision')
    if (
      sectionTitle &&
      processCandidates.length >= 2 &&
      processNodes.length < budgets.maxProcessNodes
    ) {
      processNodes.push({
        id: mkId('n'),
        type: 'process',
        label: clampText(`Section: ${sectionTitle}`, budgets.maxTitleChars),
        actor: '',
        status: 'live',
        metadata: {
          stage: sectionTitle,
          touchpoint: sectionTitle,
          notes: 'Imported section grouping',
        },
        origin,
        confidence: 0.73,
        position: { x: 0, y: 0 },
      })
    }

    section.steps.forEach((step) => {
      if (step.kind === 'process' || step.kind === 'decision') {
        if (processNodes.length >= budgets.maxProcessNodes) {
          warnings.push(`Process-node budget reached (${budgets.maxProcessNodes}).`)
          return
        }
        const nodeType = step.kind === 'decision' ? 'decision' : inferNodeTypeFromText(step.title)
        processNodes.push({
          id: mkId('n'),
          type: nodeType,
          label: clampText(step.title, budgets.maxTitleChars),
          actor: actorFromText(step.title),
          status: 'live',
          metadata: {
            stage: sectionTitle || mapStage(processNodes.length, Math.max(2, processCandidates.length)),
            touchpoint: sectionTitle || `Step ${processNodes.length + 1}`,
            notes: step.notes,
          },
          origin,
          confidence: normalizeConfidence(0.74 - processNodes.length * 0.005, 0.6),
          position: { x: 0, y: 0 },
        })
        return
      }

      if (annotationNodes.length >= budgets.maxAnnotationNodes) {
        warnings.push(`Annotation-node budget reached (${budgets.maxAnnotationNodes}).`)
        return
      }
      const prefix = step.kind === 'fact' ? 'Fact' : step.kind === 'policy' ? 'Policy' : 'Unclassified'
      annotationNodes.push({
        id: mkId('n'),
        type: 'annotation',
        label: clampText(`${prefix}: ${step.title}`, budgets.maxTitleChars),
        actor: '',
        status: 'live',
        metadata: {
          stage: sectionTitle || 'Context',
          touchpoint: sectionTitle || 'Context',
          notes: step.notes,
        },
        origin,
        confidence: 0.7,
        position: { x: 0, y: 0 },
      })
    })
  })

  if (processNodes.length === 0) {
    processNodes.push({
      id: mkId('n'),
      type: 'terminal',
      label: 'Start: Review imported content',
      actor: '',
      status: 'live',
      metadata: {
        stage: 'Review',
        touchpoint: 'Review',
        notes: 'No process steps detected. Review annotations and source text.',
      },
      origin,
      confidence: 0.62,
      position: { x: 0, y: 0 },
    })
  }

  if (processNodes.length > 0 && processNodes[0].type !== 'terminal') {
    processNodes[0] = {
      ...processNodes[0],
      type: 'terminal',
      label: clampText(`Start: ${processNodes[0].label.replace(/^Start:\s*/i, '')}`, budgets.maxTitleChars),
    }
  }
  if (processNodes.length > 1 && processNodes[processNodes.length - 1].type !== 'terminal') {
    const last = processNodes[processNodes.length - 1]
    processNodes[processNodes.length - 1] = {
      ...last,
      type: 'terminal',
      label: clampText(`End: ${last.label.replace(/^End:\s*/i, '')}`, budgets.maxTitleChars),
    }
  }

  const edges: EdgeModel[] = []
  for (let index = 0; index < processNodes.length - 1; index += 1) {
    if (edges.length >= budgets.maxEdges) {
      warnings.push(`Edge budget reached (${budgets.maxEdges}).`)
      break
    }
    const fromNode = processNodes[index]
    const toNode = processNodes[index + 1]
    edges.push({
      id: mkId('e'),
      from: fromNode.id,
      to: toNode.id,
      type: detectParallelLabel(fromNode.label) ? 'parallel' : inferEdgeTypeForImported(fromNode, toNode),
      label: fromNode.type === 'decision' ? 'Yes/No' : '',
      origin,
      confidence: 0.7,
    })
  }

  let nodes = [...processNodes, ...annotationNodes]
  if (nodes.length > budgets.maxTotalNodes) {
    const overflow = nodes.length - budgets.maxTotalNodes
    warnings.push(`Total-node budget reached (${budgets.maxTotalNodes}). Dropped ${overflow} trailing nodes.`)
    nodes = nodes.slice(0, budgets.maxTotalNodes)
  }

  const processNodeIds = new Set(nodes.filter((node) => node.type !== 'annotation').map((node) => node.id))
  const boundedEdges = edges.filter((edge) => processNodeIds.has(edge.from) && processNodeIds.has(edge.to))

  const positionedNodes = nodes.map((node, index) => {
    const isAnnotation = node.type === 'annotation'
    const rel = isAnnotation ? annotationNodes.findIndex((item) => item.id === node.id) : processNodes.findIndex((item) => item.id === node.id)
    const position = isAnnotation
      ? {
          x: 980 + (Math.max(rel, 0) % 2) * 220,
          y: 120 + Math.floor(Math.max(rel, 0) / 2) * 118,
        }
      : {
          x: 140 + (Math.max(rel, index) % 4) * 210,
          y: 120 + Math.floor(Math.max(rel, index) / 4) * 140,
        }
    return { ...node, position }
  })

  model.nodes = positionedNodes
  model.edges = boundedEdges
  positionedNodes.forEach((node) => {
    model.projections.flow.nodePositions[node.id] = node.position
    model.projections.map.nodePositions[node.id] = {
      x: node.position.x * 0.9,
      y: node.position.y * 0.7,
    }
  })
  if (warnings.length > 0) {
    model.validation.push({
      code: 'MISSING_EVIDENCE_AI_ELEMENT',
      severity: 'info',
      message: `Import normalization notes: ${warnings.join(' ')}`,
    })
  }
  validate(model)
  return model
}

function parseTocSeedClusters(text: string): string[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const contentLines = lines.filter((line) => !line.startsWith('#'))
  if (contentLines.length < 3) return null

  const clusters: string[] = []
  const seen = new Set<string>()

  for (const line of contentLines) {
    const cleaned = line.replace(/^[-*]\s*/, '')
    const match = cleaned.match(/^cluster\s*:\s*(.+)$/i)
    if (!match) return null
    const label = match[1].trim()
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    clusters.push(label)
  }

  return clusters.length >= 3 ? clusters : null
}

function importModelFromTocSeed(clusters: string[], origin: Origin): CanonicalModel {
  const model = emptyModel('TOC Seed Clusters')
  model.confidence = { overall: 0.76, extraction: 0.78, synthesis: 0.74, validationPenalty: 0 }
  model.validation = []

  const nodes: FlowNode[] = clusters.map((cluster, index) => {
    const id = mkId('n')
    return {
      id,
      type: 'annotation',
      label: `Cluster: ${cluster}`,
      actor: '',
      status: 'live',
      metadata: {
        stage: cluster,
        touchpoint: `Cluster ${index + 1}`,
      },
      origin,
      confidence: 0.78,
      position: {
        x: 160 + (index % 2) * 290,
        y: 120 + Math.floor(index / 2) * 110,
      },
    }
  })

  model.nodes = nodes
  model.edges = []
  model.projections.map.groups = clusters.map((cluster, index) => ({
    id: `cluster-${index}`,
    label: cluster,
    nodeIds: [],
  }))
  nodes.forEach((node) => {
    model.projections.flow.nodePositions[node.id] = node.position
    model.projections.map.nodePositions[node.id] = {
      x: node.position.x * 0.9,
      y: node.position.y * 0.7,
    }
  })
  return model
}

function extractSeedClustersFromModel(model: CanonicalModel): string[] {
  const directClusters = model.nodes
    .filter((node) => node.type === 'annotation')
    .map((node) => {
      const match = node.label.match(/^cluster\s*:\s*(.+)$/i)
      return match ? match[1].trim() : null
    })
    .filter((value): value is string => Boolean(value))

  if (directClusters.length > 0) return directClusters

  const stageClusters = model.nodes
    .map((node) => node.metadata.stage?.trim())
    .filter((value): value is string => Boolean(value))

  return [...new Set(stageClusters)]
}

function keywordScore(text: string, keyword: string): number {
  if (keyword.length < 3) return 0
  return text.includes(keyword) ? keyword.length : 0
}

function assignStagesFromSeedClusters(model: CanonicalModel, clusters: string[]): CanonicalModel {
  if (clusters.length === 0) return model
  const normalizedClusters = [...new Set(clusters.map((cluster) => cluster.trim()).filter(Boolean))]
  if (normalizedClusters.length === 0) return model

  const clusterKeywords = normalizedClusters.map((cluster) => {
    const words = cluster
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
    return {
      cluster,
      keywords: [...new Set(words)],
    }
  })
  const unassigned =
    normalizedClusters.find((cluster) => cluster.toLowerCase().includes('unassigned')) ?? 'Unassigned'

  const mapped = clone(model)
  mapped.nodes = mapped.nodes.map((node) => {
    if (node.type === 'annotation' && /^cluster\s*:/i.test(node.label)) return node
    const lower = node.label.toLowerCase()
    let bestCluster = unassigned
    let bestScore = 0

    clusterKeywords.forEach(({ cluster, keywords }) => {
      const score = keywords.reduce((sum, keyword) => sum + keywordScore(lower, keyword), 0)
      if (score > bestScore) {
        bestScore = score
        bestCluster = cluster
      }
    })

    if (bestScore === 0) {
      if (/(withdraw|cashier|arn|payout)/.test(lower)) {
        const withdrawalsCluster = normalizedClusters.find((cluster) =>
          /withdraw|cashier/i.test(cluster),
        )
        if (withdrawalsCluster) bestCluster = withdrawalsCluster
      } else if (/(deposit|payment|card|bank)/.test(lower)) {
        const paymentsCluster = normalizedClusters.find((cluster) => /deposit|payment/i.test(cluster))
        if (paymentsCluster) bestCluster = paymentsCluster
      } else if (/(fraud|risk|verification|kyc)/.test(lower)) {
        const riskCluster = normalizedClusters.find((cluster) => /risk|verification/i.test(cluster))
        if (riskCluster) bestCluster = riskCluster
      }
    }

    return {
      ...node,
      metadata: {
        ...node.metadata,
        stage: bestCluster,
      },
    }
  })
  mapped.projections.map.groups = normalizedClusters.map((cluster, index) => ({
    id: `cluster-${index}`,
    label: cluster,
    nodeIds: mapped.nodes
      .filter((node) => node.metadata.stage === cluster && node.type !== 'annotation')
      .map((node) => node.id),
  }))
  return mapped
}

function importModelFromText(text: string): CanonicalModel {
  const { sections, warnings } = parseSectionsFromText(text, IMPORT_BUDGETS)
  return buildModelFromSections(sections, {
    origin: 'text_import',
    title: 'Text Imported Flow',
    confidence: { overall: 0.72, extraction: 0.74, synthesis: 0.75, validationPenalty: 0 },
    budgets: IMPORT_BUDGETS,
    warnings,
  })
}

function importModelFromDoc(text: string): CanonicalModel {
  const base = importModelFromText(text)
  base.title = 'Document Imported Flow'
  base.nodes = base.nodes.map((node) => ({
    ...node,
    origin: 'doc_import',
    evidence: [{ docId: 'doc-local', chunkId: `chunk-${node.id}`, quote: node.label.slice(0, 100) }],
    confidence: normalizeConfidence((node.confidence ?? 0.7) - 0.05, 0.62),
  }))
  base.edges = base.edges.map((edge) => ({
    ...edge,
    origin: 'doc_import',
    confidence: normalizeConfidence((edge.confidence ?? 0.7) - 0.05, 0.62),
  }))
  base.sourceDocs = [{ docId: 'doc-local', name: 'Local uploaded document', type: 'txt' }]
  base.confidence = { overall: 0.64, extraction: 0.66, synthesis: 0.67, validationPenalty: 0 }
  validate(base)
  return base
}

function applyAiAssistSignature(
  model: CanonicalModel,
  title: string,
  confidence: ConfidenceSummary,
): CanonicalModel {
  const next = clone(model)
  next.title = title
  next.nodes = next.nodes.map((node) => ({
    ...node,
    origin: 'ai_assist',
    confidence: normalizeConfidence((node.confidence ?? 0.7) - 0.08, 0.58),
  }))
  next.edges = next.edges.map((edge) => ({
    ...edge,
    origin: 'ai_assist',
    confidence: normalizeConfidence((edge.confidence ?? 0.7) - 0.08, 0.58),
  }))
  next.confidence = confidence
  validate(next)
  return next
}

function importModelFromAiPrompt(prompt: string): CanonicalModel {
  const normalized = prompt.trim()
  const lines =
    normalized.length > 0
      ? [
          `Start ${normalized}`,
          `Capture ${normalized} request details`,
          `Decision: Is ${normalized} complete?`,
          `Resolve ${normalized}`,
          `Close ${normalized}`,
        ]
      : ['Start workflow', 'Triage request', 'Decision: Is information complete?', 'Resolve case', 'Close case']
  const model = importModelFromText(lines.join('\n'))
  return applyAiAssistSignature(model, 'AI Assisted Candidate', {
    overall: 0.59,
    extraction: 0.61,
    synthesis: 0.62,
    validationPenalty: 0,
  })
}

function looksLikeStructuredStepImport(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 4) return false
  return lines.some((line) => /^(start:|end:|decision:)/i.test(line))
}

function normalizeImportedModel(input: unknown): CanonicalModel {
  if (!input || typeof input !== 'object') return emptyModel('Imported Flow')
  const raw = input as Partial<CanonicalModel>
  const model = emptyModel(raw.title?.trim() || 'Imported Flow')

  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : []
  const normalizedNodes: FlowNode[] = rawNodes
    .map((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') return null
      const item = candidate as Partial<FlowNode>
      const id = typeof item.id === 'string' && item.id.trim() ? item.id : mkId('n')
      const label =
        typeof item.label === 'string' && item.label.trim() ? item.label.trim() : `Imported Step ${index + 1}`
      const type = inferNodeTypeFromText(typeof item.type === 'string' ? item.type : label)
      const position = item.position as XY | undefined
      return {
        id,
        type,
        label,
        actor: actorFromText(typeof item.actor === 'string' ? item.actor : ''),
        status: item.status === 'planned' || item.status === 'deprecated' ? item.status : 'live',
        metadata: typeof item.metadata === 'object' && item.metadata !== null ? item.metadata : {},
        evidence: Array.isArray(item.evidence) ? item.evidence : undefined,
        confidence: normalizeConfidence(item.confidence, 0.66),
        origin: (item.origin as Origin) ?? 'text_import',
        position: {
          x: typeof position?.x === 'number' ? position.x : 140 + (index % 4) * 200,
          y: typeof position?.y === 'number' ? position.y : 120 + Math.floor(index / 4) * 140,
        },
      } as FlowNode
    })
    .filter((node): node is FlowNode => node !== null)

  const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]))

  const rawEdges = Array.isArray(raw.edges) ? raw.edges : []
  const normalizedEdges: EdgeModel[] = rawEdges
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return null
      const item = candidate as Partial<EdgeModel>
      if (typeof item.from !== 'string' || typeof item.to !== 'string') return null
      if (!nodeById.has(item.from) || !nodeById.has(item.to)) return null
      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : mkId('e'),
        from: item.from,
        to: item.to,
        type: normalizeEdgeType(typeof item.type === 'string' ? item.type : 'sequential'),
        label: typeof item.label === 'string' ? item.label : '',
        evidence: Array.isArray(item.evidence) ? item.evidence : undefined,
        confidence: normalizeConfidence(item.confidence, 0.66),
        origin: (item.origin as Origin) ?? 'text_import',
      } as EdgeModel
    })
    .filter((edge): edge is EdgeModel => edge !== null)

  model.nodes = normalizedNodes
  model.edges = normalizedEdges
  model.sourceDocs = Array.isArray(raw.sourceDocs) ? raw.sourceDocs : []
  model.confidence = {
    overall: normalizeConfidence(raw.confidence?.overall, 0.66),
    extraction: normalizeConfidence(raw.confidence?.extraction, 0.68),
    synthesis: normalizeConfidence(raw.confidence?.synthesis, 0.68),
    validationPenalty: normalizeConfidence(raw.confidence?.validationPenalty, 0),
  }
  model.validation = Array.isArray(raw.validation)
    ? (raw.validation.filter(Boolean) as ValidationResult[])
    : []
  model.nodes.forEach((node) => {
    model.projections.flow.nodePositions[node.id] = node.position
    model.projections.map.nodePositions[node.id] = {
      x: node.position.x * 0.9,
      y: node.position.y * 0.7,
    }
  })
  validate(model)
  return model
}

function applyModelToSelectedVersion(
  state: AppState,
  model: CanonicalModel,
  options?: { preserveImportedValidation?: boolean },
): AppState {
  const next = clone(state)
  const ref = getCurrentVersionRef(next)
  if (!ref) return state
  const previousState = ref.version.reviewState
  if (!options?.preserveImportedValidation) validate(model)
  ref.version.data = clone(model)
  ref.version.reviewState = 'draft'
  ref.version.reviewAudit = [
    ...(ref.version.reviewAudit ?? []),
    {
      id: mkId('audit'),
      at: now(),
      by: 'local-user',
      event: 'state_transition',
      from: previousState,
      to: 'draft',
      note: 'Imported candidate replaced current version content.',
    },
  ]
  next.selectedTab = 'flow'
  next.selectedNodeId = null
  next.selectedEdgeId = null
  ref.artifact.updatedAt = now()
  next.history = [clone(ref.version.data)]
  next.historyIndex = 0
  return next
}

function getCurrentVersionRef(state: AppState) {
  const artifact = state.artifacts.find((a) => a.id === state.selectedArtifactId)
  if (!artifact) return null
  const version = artifact.versions.find((v) => v.id === state.selectedVersionId)
  if (!version) return null
  return { artifact, version }
}

function snapshotCurrentModel(state: AppState): CanonicalModel | null {
  const ref = getCurrentVersionRef(state)
  if (!ref) return null
  return clone(ref.version.data)
}

function pushHistory(next: AppState, model: CanonicalModel) {
  next.history = next.history.slice(0, next.historyIndex + 1)
  next.history.push(clone(model))
  next.historyIndex = next.history.length - 1
  if (next.history.length > 80) {
    next.history.shift()
    next.historyIndex -= 1
  }
}

function updateCurrentVersion(state: AppState, updater: (model: CanonicalModel) => void): AppState {
  const next = clone(state)
  const ref = getCurrentVersionRef(next)
  if (!ref) return state

  updater(ref.version.data)
  validate(ref.version.data)
  ref.artifact.updatedAt = now()
  pushHistory(next, ref.version.data)
  return next
}

const initial = hydrate() ?? seedState()

export const usePMStore = create<PMStore>((set, get) => ({
  ...initial,

  createProject: (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((state) => {
      const next = clone(state)
      const projectId = mkId('proj')
      const artifactId = mkId('art')
      const versionId = mkId('ver')

      const model: CanonicalModel = {
        id: mkId('model'),
        title: `${trimmed} Flow`,
        sourceDocs: [],
        nodes: [],
        edges: [],
        confidence: { overall: 1, extraction: 1, synthesis: 1, validationPenalty: 0 },
        validation: [],
        projections: {
          flow: { nodePositions: {} },
          map: { nodePositions: {} },
        },
      }

      next.projects.push({
        id: projectId,
        workspaceId: next.workspace.id,
        folderId: null,
        name: trimmed,
        description: '',
        createdAt: now(),
        updatedAt: now(),
      })

      next.artifacts.push({
        id: artifactId,
        projectId,
        name: 'Primary Flow',
        currentVersionId: versionId,
        currentApprovedVersionId: null,
        createdAt: now(),
        updatedAt: now(),
        versions: [
          {
            id: versionId,
            artifactId,
            name: 'v1',
            schemaVersion: '1.1',
            data: model,
            reviewState: 'draft',
            reviewAudit: [],
            exportArtifacts: [],
            createdBy: 'local-user',
            createdAt: now(),
          },
        ],
      })

      next.selectedProjectId = projectId
      next.selectedArtifactId = artifactId
      next.selectedVersionId = versionId
      next.selectedNodeId = null
      next.selectedEdgeId = null
      next.selectedTab = 'flow'
      next.history = [clone(model)]
      next.historyIndex = 0
      persist(next)
      return next
    })
  },

  deleteProject: (projectId) => {
    set((state) => {
      const next = clone(state)
      next.projects = next.projects.filter((p) => p.id !== projectId)
      next.artifacts = next.artifacts.filter((a) => a.projectId !== projectId)

      if (next.selectedProjectId === projectId) {
        const fallbackProject = next.projects[0]
        next.selectedProjectId = fallbackProject?.id ?? null
        const fallbackArtifact = next.artifacts.find((a) => a.projectId === next.selectedProjectId)
        next.selectedArtifactId = fallbackArtifact?.id ?? null
        next.selectedVersionId = fallbackArtifact?.currentVersionId ?? null
      }

      next.selectedNodeId = null
      next.selectedEdgeId = null
      const model = snapshotCurrentModel(next)
      next.history = model ? [clone(model)] : []
      next.historyIndex = model ? 0 : -1
      persist(next)
      return next
    })
  },

  selectProject: (projectId) => {
    set((state) => {
      const next = clone(state)
      next.selectedProjectId = projectId
      const firstArtifact = next.artifacts.find((a) => a.projectId === projectId)
      next.selectedArtifactId = firstArtifact?.id ?? null
      next.selectedVersionId = firstArtifact?.currentVersionId ?? null
      next.selectedNodeId = null
      next.selectedEdgeId = null

      const model = snapshotCurrentModel(next)
      next.history = model ? [clone(model)] : []
      next.historyIndex = model ? 0 : -1
      persist(next)
      return next
    })
  },

  createArtifact: (projectId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return

    set((state) => {
      const next = clone(state)
      const artifactId = mkId('art')
      const versionId = mkId('ver')
      const model: CanonicalModel = {
        id: mkId('model'),
        title: `${trimmed} Flow`,
        sourceDocs: [],
        nodes: [],
        edges: [],
        confidence: { overall: 1, extraction: 1, synthesis: 1, validationPenalty: 0 },
        validation: [],
        projections: {
          flow: { nodePositions: {} },
          map: { nodePositions: {} },
        },
      }

      next.artifacts.push({
        id: artifactId,
        projectId,
        name: trimmed,
        currentVersionId: versionId,
        currentApprovedVersionId: null,
        createdAt: now(),
        updatedAt: now(),
        versions: [
          {
            id: versionId,
            artifactId,
            name: 'v1',
            schemaVersion: '1.1',
            data: model,
            reviewState: 'draft',
            reviewAudit: [],
            exportArtifacts: [],
            createdBy: 'local-user',
            createdAt: now(),
          },
        ],
      })

      next.selectedArtifactId = artifactId
      next.selectedVersionId = versionId
      next.selectedNodeId = null
      next.selectedEdgeId = null
      next.history = [clone(model)]
      next.historyIndex = 0
      persist(next)
      return next
    })
  },

  selectArtifact: (artifactId) => {
    set((state) => {
      const next = clone(state)
      const artifact = next.artifacts.find((a) => a.id === artifactId)
      if (!artifact) return state
      next.selectedArtifactId = artifactId
      next.selectedVersionId = artifact.currentVersionId
      next.selectedNodeId = null
      next.selectedEdgeId = null
      const model = snapshotCurrentModel(next)
      next.history = model ? [clone(model)] : []
      next.historyIndex = model ? 0 : -1
      persist(next)
      return next
    })
  },

  createVersion: (artifactId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((state) => {
      const next = clone(state)
      const artifact = next.artifacts.find((a) => a.id === artifactId)
      if (!artifact) return state
      const currentVersion = artifact.versions.find((v) => v.id === artifact.currentVersionId)
      if (!currentVersion) return state
      const versionId = mkId('ver')
      artifact.versions.push({
        id: versionId,
        artifactId,
        name: trimmed,
        schemaVersion: '1.1',
        data: clone(currentVersion.data),
        reviewState: 'draft',
        reviewAudit: [],
        exportArtifacts: [],
        createdBy: 'local-user',
        createdAt: now(),
      })
      artifact.currentVersionId = versionId
      artifact.updatedAt = now()
      next.selectedVersionId = versionId
      next.selectedNodeId = null
      next.selectedEdgeId = null
      next.history = [clone(currentVersion.data)]
      next.historyIndex = 0
      persist(next)
      return next
    })
  },

  selectVersion: (versionId) => {
    set((state) => {
      const next = clone(state)
      next.selectedVersionId = versionId
      next.selectedNodeId = null
      next.selectedEdgeId = null
      const model = snapshotCurrentModel(next)
      next.history = model ? [clone(model)] : []
      next.historyIndex = model ? 0 : -1
      persist(next)
      return next
    })
  },

  setTab: (tab: ViewTab) => {
    set((state) => {
      const next = clone(state)
      next.selectedTab = tab
      persist(next)
      return next
    })
  },

  updateNodeLabel: (nodeId, label) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        model.nodes = model.nodes.map((n) => (n.id === nodeId ? { ...n, label } : n))
      })
      persist(next)
      return next
    })
  },

  updateNodeNotes: (nodeId, notes) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        model.nodes = model.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                metadata: {
                  ...n.metadata,
                  notes,
                },
              }
            : n,
        )
      })
      persist(next)
      return next
    })
  },

  updateNodeActor: (nodeId, actor) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        model.nodes = model.nodes.map((n) => (n.id === nodeId ? { ...n, actor } : n))
      })
      persist(next)
      return next
    })
  },

  setVersionReviewState: (versionId, reviewState) => {
    set((state) => {
      const next = clone(state)
      const artifact = next.artifacts.find((item) => item.id === next.selectedArtifactId)
      if (!artifact) return state
      const version = artifact.versions.find((item) => item.id === versionId)
      if (!version) return state
      const fromState = version.reviewState
      version.reviewState = normalizeReviewState(reviewState)
      if (version.reviewState === 'approved') {
        const hasBlockingIssues = version.data.validation.some((issue) => issue.severity === 'error')
        if (hasBlockingIssues) {
          version.reviewAudit = [
            ...(version.reviewAudit ?? []),
            {
              id: mkId('audit'),
              at: now(),
              by: 'local-user',
              event: 'policy_block',
              from: fromState,
              to: 'approved',
              note: 'Blocked: version has validation errors.',
            },
          ]
          version.reviewState = 'in_review'
          persist(next)
          return next
        }
      }

      if (version.reviewState === 'approved') {
        const hasUngatedLowConfidence = version.data.confidence.overall < 0.78
        if (hasUngatedLowConfidence) {
          version.reviewAudit = [
            ...(version.reviewAudit ?? []),
            {
              id: mkId('audit'),
              at: now(),
              by: 'local-user',
              event: 'policy_block',
              from: fromState,
              to: 'approved',
              note: 'Blocked: confidence below auto-approve threshold (0.78).',
            },
          ]
          version.reviewState = 'in_review'
          persist(next)
          return next
        }
      }

      if (version.reviewState === 'approved') {
        artifact.currentApprovedVersionId = version.id
      }
      version.reviewAudit = [
        ...(version.reviewAudit ?? []),
        {
          id: mkId('audit'),
          at: now(),
          by: 'local-user',
          event: 'state_transition',
          from: fromState,
          to: version.reviewState,
          note: 'Manual review state update.',
        },
      ]
      artifact.updatedAt = now()
      persist(next)
      return next
    })
  },

  requestReviewTransition: (versionId, nextState, note) => {
    let result = { ok: false, message: 'Select a valid version first.' }
    set((state) => {
      const next = clone(state)
      const artifact = next.artifacts.find((item) => item.id === next.selectedArtifactId)
      if (!artifact) return state
      const version = artifact.versions.find((item) => item.id === versionId)
      if (!version) return state

      const fromState = version.reviewState
      if (nextState === 'approved') {
        const hasBlockingIssues = version.data.validation.some((issue) => issue.severity === 'error')
        if (hasBlockingIssues) {
          version.reviewAudit = [
            ...(version.reviewAudit ?? []),
            {
              id: mkId('audit'),
              at: now(),
              by: 'policy-engine',
              event: 'policy_block',
              from: fromState,
              to: nextState,
              note: 'Blocked: unresolved validation errors.',
            },
          ]
          version.reviewState = 'in_review'
          artifact.updatedAt = now()
          persist(next)
          result = { ok: false, message: 'Approval blocked by policy: validation errors present.' }
          return next
        }
        if (version.data.confidence.overall < 0.78) {
          version.reviewAudit = [
            ...(version.reviewAudit ?? []),
            {
              id: mkId('audit'),
              at: now(),
              by: 'policy-engine',
              event: 'policy_block',
              from: fromState,
              to: nextState,
              note: 'Blocked: confidence below approval threshold (0.78).',
            },
          ]
          version.reviewState = 'in_review'
          artifact.updatedAt = now()
          persist(next)
          result = { ok: false, message: 'Approval blocked by policy: low confidence.' }
          return next
        }
      }

      version.reviewState = nextState
      version.reviewAudit = [
        ...(version.reviewAudit ?? []),
        {
          id: mkId('audit'),
          at: now(),
          by: 'local-user',
          event: 'state_transition',
          from: fromState,
          to: nextState,
          note: note ?? 'Manual review transition',
        },
      ]
      if (nextState === 'approved') artifact.currentApprovedVersionId = version.id
      artifact.updatedAt = now()
      persist(next)
      result = { ok: true, message: `Review moved ${fromState} -> ${nextState}.` }
      return next
    })
    return result
  },

  importFromText: (text) => {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: 'Text import failed: empty input.' }
    const tocClusters = parseTocSeedClusters(trimmed)
    const imported = tocClusters
      ? importModelFromTocSeed(tocClusters, 'text_import')
      : assignStagesFromSeedClusters(
          importModelFromText(trimmed),
          extractSeedClustersFromModel(snapshotCurrentModel(get()) ?? emptyModel('')),
        )
    set((state) => {
      const next = applyModelToSelectedVersion(
        state,
        imported,
        tocClusters ? { preserveImportedValidation: true } : undefined,
      )
      persist(next)
      return next
    })
    if (tocClusters) {
      return {
        ok: true,
        message: `TOC seed imported ${imported.nodes.length} clusters (no auto-connections).`,
      }
    }
    return {
      ok: true,
      message: `Text import generated ${imported.nodes.length} nodes and ${imported.edges.length} edges.`,
    }
  },

  importFromDocument: (payload) => {
    const trimmed = payload.trim()
    if (!trimmed) return { ok: false, message: 'Document import failed: no extractable text found.' }
    const imported = assignStagesFromSeedClusters(
      importModelFromDoc(trimmed),
      extractSeedClustersFromModel(snapshotCurrentModel(get()) ?? emptyModel('')),
    )
    set((state) => {
      const next = applyModelToSelectedVersion(state, imported)
      persist(next)
      return next
    })
    return {
      ok: true,
      message: `Document import generated ${imported.nodes.length} nodes and ${imported.edges.length} edges.`,
    }
  },

  importFromAiAssist: (prompt: string) => {
    const trimmed = prompt.trim()
    const tocClusters = trimmed ? parseTocSeedClusters(trimmed) : null
    const structuredStepImport =
      !tocClusters && trimmed.length > 0 ? looksLikeStructuredStepImport(trimmed) : false
    const imported = tocClusters
      ? importModelFromTocSeed(tocClusters, 'ai_assist')
      : structuredStepImport
        ? applyAiAssistSignature(
            assignStagesFromSeedClusters(
              importModelFromText(trimmed),
              extractSeedClustersFromModel(snapshotCurrentModel(get()) ?? emptyModel('')),
            ),
            'AI Assisted Structured Import',
            {
              overall: 0.63,
              extraction: 0.66,
              synthesis: 0.64,
              validationPenalty: 0,
            },
          )
      : applyAiAssistSignature(
          assignStagesFromSeedClusters(
            importModelFromAiPrompt(prompt),
            extractSeedClustersFromModel(snapshotCurrentModel(get()) ?? emptyModel('')),
          ),
          'AI Assisted Candidate',
          {
            overall: 0.63,
            extraction: 0.66,
            synthesis: 0.64,
            validationPenalty: 0,
          },
        )
    set((state) => {
      const next = applyModelToSelectedVersion(
        state,
        imported,
        tocClusters ? { preserveImportedValidation: true } : undefined,
      )
      persist(next)
      return next
    })
    if (tocClusters) {
      return {
        ok: true,
        message: `AI assist detected TOC seed and imported ${imported.nodes.length} clusters.`,
      }
    }
    if (structuredStepImport) {
      return {
        ok: true,
        message: `AI assist detected structured step input and imported ${imported.nodes.length} nodes.`,
      }
    }
    return {
      ok: true,
      message: `AI assist generated ${imported.nodes.length} candidate nodes. Routed for review.`,
    }
  },

  clearCurrentVersion: () => {
    const state = get()
    const ref = getCurrentVersionRef(state)
    if (!ref) {
      return { ok: false, message: 'Clear failed: select a version first.' }
    }
    const blank = emptyModel('Import Draft')
    set((current) => {
      const next = applyModelToSelectedVersion(current, blank)
      persist(next)
      return next
    })
    return { ok: true, message: 'Cleared current version to a blank import draft.' }
  },

  setImportDocumentMapForSelectedVersion: (kind, documentMap) => {
    set((state) => {
      const next = clone(state)
      const ref = getCurrentVersionRef(next)
      if (!ref) return state
      const existing = ref.version.importDocumentMaps
      const bundle: ImportDocumentMapBundle = existing
        ? clone(existing)
        : {
            contentMap: null,
            importedMap: null,
          }
      bundle[kind] = documentMap ? clone(documentMap) : null
      ref.version.importDocumentMaps = bundle
      ref.artifact.updatedAt = now()
      persist(next)
      return next
    })
  },

  getImportDocumentMapForSelectedVersion: (kind) => {
    const state = get()
    const ref = getCurrentVersionRef(state)
    if (!ref) return null
    const bundle = ref.version.importDocumentMaps
    if (!bundle) return null
    const map = bundle[kind]
    return map ? (clone(map) as ImportDocumentMap) : null
  },

  getImportDocumentMapsForSelectedVersion: () => {
    const state = get()
    const ref = getCurrentVersionRef(state)
    if (!ref || !ref.version.importDocumentMaps) return null
    return clone(ref.version.importDocumentMaps)
  },

  importFromJson: (rawJson) => {
    let imported: CanonicalModel
    let importMode: 'lossless' | 'canonical' | 'normalized' = 'normalized'
    try {
      const parsed = parseJsonImport(rawJson)
      if ((parsed.mode === 'lossless' || parsed.mode === 'canonical') && parsed.model) {
        imported = clone(parsed.model)
        importMode = parsed.mode
      } else {
        imported = normalizeImportedModel(JSON.parse(rawJson) as unknown)
      }
    } catch {
      return { ok: false, message: 'Import failed: invalid JSON format.' }
    }
    if (imported.nodes.length === 0) {
      return { ok: false, message: 'Import failed: no valid nodes found in JSON.' }
    }
    set((state) => {
      const next = applyModelToSelectedVersion(
        state,
        imported,
        importMode === 'normalized' ? undefined : { preserveImportedValidation: true },
      )
      persist(next)
      return next
    })
    const modeHint =
      importMode === 'lossless'
        ? ' Preserved export contract with lossless model roundtrip.'
        : importMode === 'canonical'
          ? ' Applied canonical model directly.'
          : ''
    return {
      ok: true,
      message: `JSON import applied ${imported.nodes.length} nodes and ${imported.edges.length} edges.${modeHint}`,
    }
  },

  recordExportForSelectedVersion: (payload) => {
    set((state) => {
      const next = clone(state)
      const ref = getCurrentVersionRef(next)
      if (!ref) return state
      const record: ExportArtifact = {
        id: mkId('exp'),
        artifactId: ref.artifact.id,
        versionId: ref.version.id,
        format: payload.format,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        sizeBytes: payload.sizeBytes,
        checksum: payload.checksum,
        createdAt: now(),
      }
      ref.version.exportArtifacts = [...(ref.version.exportArtifacts ?? []), record]
      ref.artifact.updatedAt = now()
      persist(next)
      return next
    })
  },

  getExportHistoryForSelectedVersion: () => {
    const state = get()
    const ref = getCurrentVersionRef(state)
    if (!ref) return []
    return clone(ref.version.exportArtifacts ?? [])
  },

  runValidation: () => {
    let output: { errors: number; warns: number } = { errors: 0, warns: 0 }
    set((state) => {
      const next = clone(state)
      const ref = getCurrentVersionRef(next)
      if (!ref) return state
      validate(ref.version.data)
      output = {
        errors: ref.version.data.validation.filter((item) => item.severity === 'error').length,
        warns: ref.version.data.validation.filter((item) => item.severity === 'warn').length,
      }
      ref.artifact.updatedAt = now()
      persist(next)
      return next
    })
    return output
  },

  runValidationForCurrentVersion: () => {
    let issues: ValidationResult[] = []
    set((state) => {
      const next = clone(state)
      const ref = getCurrentVersionRef(next)
      if (!ref) return state
      validate(ref.version.data)
      issues = clone(ref.version.data.validation)
      ref.artifact.updatedAt = now()
      persist(next)
      return next
    })
    return issues
  },

  canTransitionToReviewState: (versionId: string, nextState: ReviewState) => {
    const state = get()
    const artifact = state.artifacts.find((item) => item.id === state.selectedArtifactId)
    if (!artifact) return { allowed: false, reason: 'No selected artifact.' }
    const version = artifact.versions.find((item) => item.id === versionId)
    if (!version) return { allowed: false, reason: 'Version not found.' }
    if (nextState !== 'approved') return { allowed: true, reason: 'Transition allowed.' }
    const hasErrors = version.data.validation.some((issue) => issue.severity === 'error')
    if (hasErrors) return { allowed: false, reason: 'Blocking validation errors.' }
    if (version.data.confidence.overall < 0.78) {
      return { allowed: false, reason: 'Confidence below 0.78 threshold.' }
    }
    return { allowed: true, reason: 'Validation and confidence satisfy policy.' }
  },

  getReviewAuditTrail: () => {
    const state = get()
    const ref = getCurrentVersionRef(state)
    if (!ref) return []
    const version = ref.version
    const model = version.data
    const hasErrors = model.validation.some((item) => item.severity === 'error')
    const lowConfidence = model.confidence.overall < 0.78
    const route = version.reviewState === 'approved' ? 'auto-approve' : 'human-review'
    return [
      `Version: ${version.name} (${version.id})`,
      `Review state: ${version.reviewState}`,
      `Confidence overall: ${model.confidence.overall.toFixed(2)}`,
      `Validation: ${model.validation.length} issues (${hasErrors ? 'blocking' : 'non-blocking'})`,
      `Policy route: ${route}${lowConfidence ? ' (low confidence)' : ''}`,
      `Timestamp: ${now()}`,
    ]
  },

  sendCurrentVersionToReview: () => {
    const state = get()
    const ref = getCurrentVersionRef(state)
    if (!ref) return false
    const result = get().requestReviewTransition(ref.version.id, 'in_review', 'Submitted for human review.')
    return result.ok
  },

  autoGateCurrentVersion: () => {
    const state = get()
    const ref = getCurrentVersionRef(state)
    if (!ref) return null
    const policy = get().canTransitionToReviewState(ref.version.id, 'approved')
    const nextState: ReviewState = policy.allowed ? 'approved' : 'in_review'
    const transition = get().requestReviewTransition(
      ref.version.id,
      nextState,
      policy.allowed
        ? 'Auto-gated to approved by confidence/validation policy.'
        : `Auto-routed to in_review: ${policy.reason}`,
    )
    if (!transition.ok) return null
    return {
      state: nextState,
      reason: policy.allowed ? 'Confidence and validation satisfy policy.' : policy.reason,
    }
  },

  addNodeToCurrentVersion: (node) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        model.nodes.push(node)
        model.projections.flow.nodePositions[node.id] = node.position
      })
      persist(next)
      return next
    })
  },

  removeNodeFromCurrentVersion: (nodeId) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        model.nodes = model.nodes.filter((n) => n.id !== nodeId)
        model.edges = model.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
        delete model.projections.flow.nodePositions[nodeId]
      })
      next.selectedNodeId = null
      next.selectedEdgeId = null
      persist(next)
      return next
    })
  },

  addEdgeToCurrentVersion: (edge) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        const exists = model.edges.some((e) => e.from === edge.from && e.to === edge.to)
        if (!exists) model.edges.push(edge)
      })
      persist(next)
      return next
    })
  },

  removeEdgeFromCurrentVersion: (edgeId) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        model.edges = model.edges.filter((e) => e.id !== edgeId)
      })
      next.selectedEdgeId = null
      persist(next)
      return next
    })
  },

  updateEdgeLabel: (edgeId, label) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        model.edges = model.edges.map((e) => (e.id === edgeId ? { ...e, label } : e))
      })
      persist(next)
      return next
    })
  },

  updateEdgeType: (edgeId, type) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        model.edges = model.edges.map((e) => (e.id === edgeId ? { ...e, type } : e))
      })
      persist(next)
      return next
    })
  },

  updateCurrentVersionLayoutFromRF: (positions) => {
    set((state) => {
      const next = clone(state)
      const ref = getCurrentVersionRef(next)
      if (!ref) return state
      positions.forEach(({ id, position }) => {
        ref.version.data.projections.flow.nodePositions[id] = position
        ref.version.data.nodes = ref.version.data.nodes.map((n) => (n.id === id ? { ...n, position } : n))
      })
      validate(ref.version.data)
      ref.artifact.updatedAt = now()
      persist(next)
      return next
    })
  },

  selectNode: (nodeId) => {
    set((state) => ({
      ...state,
      selectedNodeId: nodeId,
      selectedEdgeId: null,
    }))
  },

  selectEdge: (edgeId) => {
    set((state) => ({
      ...state,
      selectedEdgeId: edgeId,
      selectedNodeId: null,
    }))
  },

  undoCurrentVersion: () => {
    set((state) => {
      if (state.historyIndex <= 0) return state
      const next = clone(state)
      const newIndex = next.historyIndex - 1
      const snapshot = clone(next.history[newIndex])
      const ref = getCurrentVersionRef(next)
      if (!ref) return state
      ref.version.data = snapshot
      next.historyIndex = newIndex
      next.selectedNodeId = null
      next.selectedEdgeId = null
      persist(next)
      return next
    })
  },

  getSelectedVersion: () => {
    const state = get()
    return getCurrentVersionRef(state)?.version
  },

  getCurrentModel: () => {
    const state = get()
    return snapshotCurrentModel(state) ?? undefined
  },

  getValidation: () => {
    const state = get()
    return snapshotCurrentModel(state)?.validation ?? []
  },
}))

export function edgeStroke(type: EdgeType) {
  if (type === 'conditional') return '#2d6ef5'
  if (type === 'parallel') return '#0f9e6e'
  if (type === 'fallback') return '#e0443a'
  return '#9fa9b9'
}

export function buildDefaultNode(index: number, type: FlowNode['type'] = 'process'): FlowNode {
  const defaults: Record<FlowNode['type'], string> = {
    process: 'Process Step',
    decision: 'Decision?',
    terminal: 'Terminal',
    data: 'Data / System',
    annotation: 'Note',
  }
  return {
    id: mkId('n'),
    type,
    label: defaults[type],
    actor: '',
    status: 'live',
    origin: 'manual',
    metadata: {},
    position: {
      x: 160 + (index % 4) * 180,
      y: 120 + Math.floor(index / 4) * 120,
    },
  }
}

export function buildDefaultEdge(from: string, to: string): FlowEdge {
  return {
    id: mkId('e'),
    from,
    to,
    type: 'sequential',
    label: '',
    origin: 'manual',
  }
}
