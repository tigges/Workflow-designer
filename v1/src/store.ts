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
  actorHint: Actor
}

type ParsedImportSection = {
  title: string
  steps: ParsedImportStep[]
}

type SectionActorProfile = {
  dominantActor: Actor
  scoreByActor: Partial<Record<Actor, number>>
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

type LayoutTag = 'process' | 'fact' | 'policy' | 'unclassified'

type LayoutRulesConfig = {
  summary: string[]
  nodeFootprints: Record<FlowNodeType, { width: number; height: number }>
  process: {
    startX: number
    startY: number
    columnsMin: number
    columnsMax: number
    colGap: number
    rowGap: number
  }
  annotation: {
    clusterOffsetX: number
    colGap: number
    rowGap: number
    groupGapY: number
  }
  handleRouting: {
    sameRowTolerance: number
  }
  overlapGuard: {
    padding: number
    maxPlacementAttempts: number
    processShiftX: number
    processShiftY: number
    annotationShiftX: number
    annotationShiftY: number
  }
  decision: {
    enforceYesNo: boolean
    autoFallbackNoBranch: boolean
  }
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

const DEFAULT_LAYOUT_RULES: LayoutRulesConfig = {
  summary: [
    'Start terminal uses right-side output handle.',
    'End terminal uses left-side input handle.',
    'Sequential nodes stack horizontally until wrap row.',
    'Decision nodes expose explicit Yes and No exits.',
    'Fact and policy annotations are clustered away from process path.',
    'No node overlap: rectangular bounds are separated after placement.',
  ],
  nodeFootprints: {
    process: { width: 164, height: 84 },
    decision: { width: 170, height: 140 },
    terminal: { width: 128, height: 92 },
    data: { width: 164, height: 84 },
    annotation: { width: 170, height: 84 },
  },
  process: {
    startX: 140,
    startY: 120,
    columnsMin: 3,
    columnsMax: 6,
    colGap: 230,
    rowGap: 190,
  },
  annotation: {
    clusterOffsetX: 320,
    colGap: 230,
    rowGap: 126,
    groupGapY: 90,
  },
  handleRouting: {
    sameRowTolerance: 24,
  },
  overlapGuard: {
    padding: 16,
    maxPlacementAttempts: 14,
    processShiftX: 84,
    processShiftY: 70,
    annotationShiftX: 116,
    annotationShiftY: 66,
  },
  decision: {
    enforceYesNo: true,
    autoFallbackNoBranch: true,
  },
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
const VERB_PREFIX_RE =
  /^(?:start|end|capture|check|verify|validate|review|process|handle|guide|inform|notify|escalate|cancel|resolve|create|update|open|close|submit|set|ask|confirm)\b[:\s-]*/i
const CLUSTER_DOMAIN_ALIAS: Record<string, string> = {
  withdrawals: 'Withdrawal',
  withdrawal: 'Withdrawal',
  cashier: 'Withdrawal',
  payment: 'Payment',
  payments: 'Payment',
  deposit: 'Deposit',
  deposits: 'Deposit',
  verification: 'Verification',
  risk: 'Risk',
  support: 'Support',
  account: 'Account',
}

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

function titleCase(value: string): string {
  const lower = value.toLowerCase()
  return lower
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
}

function normalizeDedupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const aSet = new Set(a)
  const bSet = new Set(b)
  let intersect = 0
  for (const token of aSet) {
    if (bSet.has(token)) intersect += 1
  }
  const union = new Set([...aSet, ...bSet]).size
  return union === 0 ? 0 : intersect / union
}

function compressProcessTitle(raw: string, budgets: ImportBudgets): string {
  const cleaned = normalizeLine(stripLineMarkers(raw))
    .replace(/^\[(process|decision|fact|policy|unclassified)\]\s*/i, '')
    .replace(VERB_PREFIX_RE, '')
    .replace(/^player\b/i, '')
    .replace(/^agent\b/i, '')
    .replace(/^system\b/i, '')
    .trim()
  if (!cleaned) return 'Imported step'
  const compact = cleaned
    .replace(/\b(?:for|to|with|by|from)\b.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clampText(titleCase(compact || cleaned), budgets.maxTitleChars)
}

function splitFactPolicySentence(text: string): string[] {
  const normalized = normalizeLine(text)
  if (!normalized) return []
  const parts = normalized
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9])/)
    .map((part) => normalizeLine(part))
    .filter((part) => part.length >= 8)
  return parts.length > 0 ? parts : [normalized]
}

function classifyFactPolicySentence(sentence: string): ParsedImportStep['kind'] {
  const lower = sentence.toLowerCase()
  const policySignals = [
    /\bmust\b/,
    /\brequired\b/,
    /\bshould\b/,
    /\bwithin\b/,
    /\bsla\b/,
    /\bmandatory\b/,
    /\bcannot\b/,
    /\bnever\b/,
    /\bbusiness day\b/,
    /\brule\b/,
  ]
  const factSignals = [
    /\bmeans\b/,
    /\bdefined as\b/,
    /\brefers to\b/,
    /\bcurrently\b/,
    /\bbaseline\b/,
    /\bkpi\b/,
    /\bcontext\b/,
    /\bfact\b/,
  ]
  const policyScore = policySignals.reduce((score, signal) => (signal.test(lower) ? score + 1 : score), 0)
  const factScore = factSignals.reduce((score, signal) => (signal.test(lower) ? score + 1 : score), 0)
  return policyScore >= Math.max(1, factScore) ? 'policy' : 'fact'
}

function inferActorForStep(stepTitle: string, sectionActor: Actor): Actor {
  const direct = actorFromText(stepTitle)
  if (direct) return direct
  return sectionActor
}

function getSectionDomainHint(sectionTitle: string): string {
  const cleaned = sectionTitle
    .replace(/^[#\d.\s]+/, '')
    .replace(/\b(?:section|chapter|part)\b/gi, '')
    .trim()
  return cleaned
}

function summarizeClusterDomain(clusters: string[]): string {
  const tokens = clusters.flatMap((cluster) => tokenize(cluster))
  const counts = new Map<string, number>()
  tokens.forEach((token) => {
    const key = CLUSTER_DOMAIN_ALIAS[token] ?? token
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (ranked.length === 0) return ''
  return titleCase(ranked[0][0])
}

function buildSectionActorProfile(sections: ParsedImportSection[]): Map<string, SectionActorProfile> {
  const profile = new Map<string, SectionActorProfile>()
  sections.forEach((section) => {
    const scoreByActor: Partial<Record<Actor, number>> = {}
    section.steps.forEach((step) => {
      const actor = actorFromText(`${step.title} ${step.notes}`)
      if (!actor) return
      scoreByActor[actor] = (scoreByActor[actor] ?? 0) + 1
    })
    const ranked = (Object.entries(scoreByActor) as Array<[Actor, number]>).sort((a, b) => b[1] - a[1])
    profile.set(section.title, {
      dominantActor: ranked[0]?.[0] ?? '',
      scoreByActor,
    })
  })
  return profile
}

function rewriteTitleByCluster(title: string, clusters: string[], budgets: ImportBudgets): string {
  const domain = summarizeClusterDomain(clusters)
  const cleaned = title.replace(/^capture\s+[0-9.]+\s*/i, '').replace(/^section:\s*/i, '').trim()
  if (!domain) return clampText(cleaned || title, budgets.maxTitleChars)
  if (/^capture\b/i.test(title) || /^[0-9.]+\s*/.test(title)) {
    return clampText(`${domain}: ${compressProcessTitle(cleaned || title, budgets)}`, budgets.maxTitleChars)
  }
  return clampText(cleaned || title, budgets.maxTitleChars)
}

function pruneNearDuplicateSteps(section: ParsedImportSection): ParsedImportSection {
  const seenKeys = new Set<string>()
  const kept: ParsedImportStep[] = []
  for (const step of section.steps) {
    const key = normalizeDedupKey(step.title)
    if (!key) continue
    if (seenKeys.has(key)) continue
    const isNearDup = kept.some((existing) => {
      const sim = jaccard(tokenize(existing.title), tokenize(step.title))
      return sim >= 0.8
    })
    if (isNearDup) continue
    seenKeys.add(key)
    kept.push(step)
  }
  return { ...section, steps: kept }
}

function normalizeSectionSteps(
  section: ParsedImportSection,
  budgets: ImportBudgets,
  clusterDomainHint: string,
): ParsedImportSection {
  const sectionDomain = getSectionDomainHint(section.title)
  const baseDomain = sectionDomain || clusterDomainHint
  const normalizedSteps = section.steps.map((step) => {
    const candidateTitle = step.kind === 'process' ? compressProcessTitle(step.title, budgets) : step.title
    const titleWithDomain =
      baseDomain && !new RegExp(`\\b${baseDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(candidateTitle)
        ? `${baseDomain}: ${candidateTitle}`
        : candidateTitle
    return {
      ...step,
      title: clampText(titleWithDomain, budgets.maxTitleChars),
      notes: clampText(step.notes, budgets.maxNotesChars),
    }
  })
  return pruneNearDuplicateSteps({ ...section, steps: normalizedSteps })
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
    if (classified.kind === 'fact' || classified.kind === 'policy') {
      const splitSentences = splitFactPolicySentence(classified.text)
      for (const sentence of splitSentences) {
        if (activeSection.steps.length >= budgets.maxChildrenPerSection) break
        const kind = classifyFactPolicySentence(sentence)
        const title = kind === 'policy' ? clampText(sentence, budgets.maxTitleChars) : compressProcessTitle(sentence, budgets)
        const notes = kind === 'policy' ? '' : clampText(sentence, budgets.maxNotesChars)
        activeSection.steps.push({
          kind,
          title,
          notes,
          actorHint: inferActorForStep(sentence, ''),
        })
      }
      continue
    }
    const { title, notes } = splitTitleAndNotes(classified.text, budgets)
    const normalizedTitle =
      classified.kind === 'process' ? compressProcessTitle(title, budgets) : clampText(title, budgets.maxTitleChars)
    activeSection.steps.push({
      kind: classified.kind,
      title: normalizedTitle,
      notes,
      actorHint: inferActorForStep(`${normalizedTitle} ${notes}`, ''),
    })
  }

  const clusterDomainHint = summarizeClusterDomain(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^cluster\s*:/i.test(line))
      .map((line) => line.replace(/^cluster\s*:\s*/i, '').trim()),
  )
  const filtered = sections
    .filter((section) => section.steps.length > 0)
    .map((section) => normalizeSectionSteps(section, budgets, clusterDomainHint))
  return { sections: filtered.length > 0 ? filtered : [{ title: 'General', steps: [] }], warnings }
}

type AutoLayoutHandles = {
  sourceHandle?: 'top' | 'right' | 'bottom' | 'left'
  targetHandle?: 'top' | 'right' | 'bottom' | 'left'
}

function attachLayoutRulesMetadata(node: FlowNode, layoutGroup: LayoutTag): FlowNode {
  const existingNotes = node.metadata.notes?.trim() ?? ''
  const layoutNote = `layout_group=${layoutGroup}`
  const nextNotes = existingNotes ? `${existingNotes} | ${layoutNote}` : layoutNote
  return {
    ...node,
    metadata: {
      ...node.metadata,
      layoutGroup,
      notes: nextNotes,
    },
  }
}

function nodeBoxesOverlap(a: FlowNode, b: FlowNode, rules: LayoutRulesConfig): boolean {
  const aSize = rules.nodeFootprints[a.type]
  const bSize = rules.nodeFootprints[b.type]
  const pad = rules.overlapGuard.padding
  const aLeft = a.position.x - pad
  const aTop = a.position.y - pad
  const aRight = a.position.x + aSize.width + pad
  const aBottom = a.position.y + aSize.height + pad
  const bLeft = b.position.x - pad
  const bTop = b.position.y - pad
  const bRight = b.position.x + bSize.width + pad
  const bBottom = b.position.y + bSize.height + pad
  return !(aRight <= bLeft || bRight <= aLeft || aBottom <= bTop || bBottom <= aTop)
}

function enforceNoOverlap(nodes: FlowNode[], rules: LayoutRulesConfig): FlowNode[] {
  const placed: FlowNode[] = []
  nodes.forEach((candidate, index) => {
    const node: FlowNode = {
      ...candidate,
      position: { ...candidate.position },
    }
    let attempts = 0
    while (
      attempts < rules.overlapGuard.maxPlacementAttempts &&
      placed.some((other) => nodeBoxesOverlap(node, other, rules))
    ) {
      if (node.type === 'annotation') {
        const verticalDirection = attempts % 2 === 0 ? 1 : -1
        node.position.x += rules.overlapGuard.annotationShiftX
        node.position.y += verticalDirection * rules.overlapGuard.annotationShiftY
      } else {
        const verticalDirection = attempts % 2 === 0 ? 1 : -1
        node.position.x += rules.overlapGuard.processShiftX
        node.position.y += verticalDirection * rules.overlapGuard.processShiftY
      }
      attempts += 1
    }
    if (attempts >= rules.overlapGuard.maxPlacementAttempts) {
      // Deterministic fallback keeps dense imports readable.
      node.position.x += (index + 1) * 12
      node.position.y += (index + 1) * 10
    }
    placed.push(node)
  })
  return placed
}

function deriveEdgeHandles(
  edge: EdgeModel,
  nodeById: Map<string, FlowNode>,
  rules: LayoutRulesConfig,
): AutoLayoutHandles {
  const sourceNode = nodeById.get(edge.from)
  const targetNode = nodeById.get(edge.to)
  if (!sourceNode || !targetNode) return {}

  if (sourceNode.type === 'terminal' && /^start\b/i.test(sourceNode.label.trim())) {
    return { sourceHandle: 'right', targetHandle: 'left' }
  }
  if (targetNode.type === 'terminal' && /^end\b/i.test(targetNode.label.trim())) {
    return { sourceHandle: 'right', targetHandle: 'left' }
  }

  const sameRow = Math.abs(sourceNode.position.y - targetNode.position.y) <= rules.handleRouting.sameRowTolerance
  if (sameRow) {
    return {
      sourceHandle: sourceNode.position.x <= targetNode.position.x ? 'right' : 'left',
      targetHandle: sourceNode.position.x <= targetNode.position.x ? 'left' : 'right',
    }
  }
  return {
    sourceHandle: sourceNode.position.y <= targetNode.position.y ? 'bottom' : 'top',
    targetHandle: sourceNode.position.y <= targetNode.position.y ? 'top' : 'bottom',
  }
}

function buildModelFromSections(
  sections: ParsedImportSection[],
  options: {
    origin: Origin
    title: string
    confidence: ConfidenceSummary
    budgets: ImportBudgets
    warnings: string[]
    clusters?: string[]
  },
): CanonicalModel {
  const { origin, title, confidence, budgets, warnings, clusters = [] } = options
  const layoutRules = DEFAULT_LAYOUT_RULES
  const model = emptyModel(title)
  model.confidence = confidence
  const sectionActorProfiles = buildSectionActorProfile(sections)
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
        label: rewriteTitleByCluster(`Section: ${sectionTitle}`, clusters, budgets),
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
        const sectionActor = sectionActorProfiles.get(section.title)?.dominantActor ?? ''
        processNodes.push({
          id: mkId('n'),
          type: nodeType,
          label: rewriteTitleByCluster(step.title, clusters, budgets),
          actor: inferActorForStep(`${step.title} ${step.notes}`, sectionActor || step.actorHint),
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
        label: clampText(`${prefix}: ${rewriteTitleByCluster(step.title, clusters, budgets)}`, budgets.maxTitleChars),
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
      label: fromNode.type === 'decision' ? 'Yes' : '',
      origin,
      confidence: 0.7,
    })
  }

  // Content allocation engine: shape semantic branch logic before layout.
  const decisionNodes = processNodes.filter((node) => node.type === 'decision')
  decisionNodes.forEach((decisionNode) => {
    const outgoing = edges.filter((edge) => edge.from === decisionNode.id)
    if (outgoing.length === 0) return

    outgoing.forEach((edge) => {
      if (/yes\s*\/\s*no/i.test(edge.label ?? '')) edge.label = 'Yes'
    })

    const yesEdge = outgoing.find((edge) => /(^|\s)yes(\s|$)/i.test(edge.label ?? '')) ?? outgoing[0]
    yesEdge.label = 'Yes'
    yesEdge.type = 'conditional'

    let noEdge = outgoing.find((edge) => /(^|\s)no(\s|$)/i.test(edge.label ?? ''))
    if (!noEdge) {
      if (processNodes.length + annotationNodes.length < budgets.maxTotalNodes && edges.length < budgets.maxEdges) {
        const fallbackNode: FlowNode = {
          id: mkId('n'),
          type: 'annotation',
          label: clampText(`Policy: No branch for ${decisionNode.label.replace(/^Decision:\s*/i, '')}`, budgets.maxTitleChars),
          actor: '',
          status: 'live',
          metadata: {
            stage: 'Unassigned Policy',
            touchpoint: 'Decision fallback',
            notes: 'Auto-generated fallback branch to preserve decision Yes/No structure.',
          },
          origin,
          confidence: normalizeConfidence((decisionNode.confidence ?? 0.66) - 0.05, 0.58),
          position: { x: 0, y: 0 },
        }
        annotationNodes.push(fallbackNode)
        noEdge = {
          id: mkId('e'),
          from: decisionNode.id,
          to: fallbackNode.id,
          type: 'fallback',
          label: 'No',
          origin,
          confidence: normalizeConfidence((decisionNode.confidence ?? 0.66) - 0.05, 0.58),
        }
        edges.push(noEdge)
      }
    }
    if (noEdge) {
      noEdge.label = 'No'
      if (noEdge.type === 'sequential') noEdge.type = 'conditional'
    }

    outgoing
      .filter((edge) => edge.id !== yesEdge.id && (!noEdge || edge.id !== noEdge.id))
      .forEach((edge) => {
        if (/yes|no/i.test(edge.label ?? '')) edge.label = ''
      })
  })

  let nodes = [...processNodes, ...annotationNodes]
  if (nodes.length > budgets.maxTotalNodes) {
    const overflow = nodes.length - budgets.maxTotalNodes
    warnings.push(`Total-node budget reached (${budgets.maxTotalNodes}). Dropped ${overflow} trailing nodes.`)
    nodes = nodes.slice(0, budgets.maxTotalNodes)
  }

  // Keep every semantic edge whose endpoints survive node-budget bounding.
  const boundedNodeIds = new Set(nodes.map((node) => node.id))
  const boundedEdges = edges.filter((edge) => boundedNodeIds.has(edge.from) && boundedNodeIds.has(edge.to))
  if (boundedEdges.length < edges.length) {
    warnings.push(
      `Dropped ${edges.length - boundedEdges.length} edge(s) because one endpoint exceeded node budget.`,
    )
  }

  // Layout engine: position and route, never rewrite semantic content.
  const processLaneNodes = nodes.filter((node) => node.type !== 'annotation')
  const annotationLaneNodes = nodes.filter((node) => node.type === 'annotation')
  const processById = new Map(processLaneNodes.map((node) => [node.id, node]))
  const annotationById = new Map(annotationLaneNodes.map((node) => [node.id, node]))
  const maxProcessColumns = Math.max(
    layoutRules.process.columnsMin,
    Math.min(layoutRules.process.columnsMax, processLaneNodes.length),
  )
  const processX = layoutRules.process.startX
  const processY = layoutRules.process.startY
  const processColGap = layoutRules.process.colGap
  const processRowGap = layoutRules.process.rowGap
  const processPositions = new Map<string, XY>()
  processLaneNodes.forEach((node, index) => {
    const row = Math.floor(index / maxProcessColumns)
    const col = index % maxProcessColumns
    processPositions.set(node.id, {
      x: processX + col * processColGap,
      y: processY + row * processRowGap,
    })
  })

  const processMaxX =
    processLaneNodes.length > 0
      ? Math.max(...[...processPositions.values()].map((position) => position.x))
      : processX
  const annotationClusterX = processMaxX + layoutRules.annotation.clusterOffsetX
  const annotationColGap = layoutRules.annotation.colGap
  const annotationRowGap = layoutRules.annotation.rowGap

  const factNodes = annotationLaneNodes.filter((node) => /^fact\s*:/i.test(node.label))
  const policyNodes = annotationLaneNodes.filter((node) => /^policy\s*:/i.test(node.label))
  const unclassifiedNodes = annotationLaneNodes.filter(
    (node) => !factNodes.some((item) => item.id === node.id) && !policyNodes.some((item) => item.id === node.id),
  )

  const annotationPositions = new Map<string, XY>()
  const placeAnnotationGroup = (group: FlowNode[], startY: number) => {
    group.forEach((node, index) => {
      const col = index % 2
      const row = Math.floor(index / 2)
      annotationPositions.set(node.id, {
        x: annotationClusterX + col * annotationColGap,
        y: startY + row * annotationRowGap,
      })
    })
  }

  const factStartY = processY
  const policyStartY =
    factStartY +
    Math.max(1, Math.ceil(factNodes.length / 2)) * annotationRowGap +
    layoutRules.annotation.groupGapY
  const unclassifiedStartY =
    policyStartY +
    Math.max(1, Math.ceil(policyNodes.length / 2)) * annotationRowGap +
    layoutRules.annotation.groupGapY
  placeAnnotationGroup(factNodes, factStartY)
  placeAnnotationGroup(policyNodes, policyStartY)
  placeAnnotationGroup(unclassifiedNodes, unclassifiedStartY)

  const positionedNodes = nodes.map((node) => {
    if (processById.has(node.id)) {
      const withPosition = { ...node, position: processPositions.get(node.id) ?? { x: processX, y: processY } }
      return attachLayoutRulesMetadata(withPosition, 'process')
    }
    if (annotationById.has(node.id)) {
      const withPosition = {
        ...node,
        position: annotationPositions.get(node.id) ?? { x: annotationClusterX, y: unclassifiedStartY },
      }
      const tag: LayoutTag = /^fact\s*:/i.test(node.label)
        ? 'fact'
        : /^policy\s*:/i.test(node.label)
          ? 'policy'
          : 'unclassified'
      return attachLayoutRulesMetadata(withPosition, tag)
    }
    return node
  })

  const nonOverlappingNodes = enforceNoOverlap(positionedNodes, layoutRules)
  const nodeByIdForRouting = new Map(nonOverlappingNodes.map((node) => [node.id, node]))
  const routedEdges = boundedEdges.map((edge) => {
    const handles = deriveEdgeHandles(edge, nodeByIdForRouting, layoutRules)
    return {
      ...edge,
      ...handles,
    }
  })

  model.nodes = nonOverlappingNodes
  model.edges = routedEdges
  nonOverlappingNodes.forEach((node) => {
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
  model.validation.push({
    code: 'MISSING_EVIDENCE_AI_ELEMENT',
    severity: 'info',
    message: `Layout rules: ${layoutRules.summary.join(' ')}`,
  })
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

function importModelFromText(text: string, clusters: string[] = []): CanonicalModel {
  const { sections, warnings } = parseSectionsFromText(text, IMPORT_BUDGETS)
  return buildModelFromSections(sections, {
    origin: 'text_import',
    title: 'Text Imported Flow',
    confidence: { overall: 0.72, extraction: 0.74, synthesis: 0.75, validationPenalty: 0 },
    budgets: IMPORT_BUDGETS,
    warnings,
    clusters,
  })
}

function importModelFromDoc(text: string, clusters: string[] = []): CanonicalModel {
  const base = importModelFromText(text, clusters)
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
    sourceHandle: 'right',
    targetHandle: 'left',
  }
}
