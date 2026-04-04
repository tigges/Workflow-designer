import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type ReactFlowInstance,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { buildDefaultEdge, buildDefaultNode, edgeStroke, usePMStore } from './store'
import {
  exportMimeType,
  sha256Hex,
  svgToPngBlob,
  toJsonExportString,
  toMermaidFlowchart,
  toSvgSnapshot,
  verifyJsonRoundtripLossless,
} from './exportUtils'
import type {
  Actor,
  CanonicalModel,
  EdgeType,
  ExportFormat,
  FlowEdge,
  FlowNode,
  ImportDocumentBlock,
  ImportDocumentBlockType,
  ImportDocumentMap,
  ImportDocumentMapKind,
  ReviewState,
} from './types'
import { GOLD_IMPORT_FIXTURES, evaluateImportQuality, type GoldImportFixture, type ImportEvalMetrics } from './evals'

type RFNodeData = {
  label: string
  title: string
  note: string
  actor: Actor
  kind: FlowNode['type']
  status: FlowNode['status']
  terminalRole: 'start' | 'end' | null
}

const TEMPLATE_TABS = ['Support', 'Onboarding', 'Sales', 'Blank'] as const
const QUICK_IMPORT_TEMPLATES = [
  {
    id: 'support',
    tab: 'Support',
    label: 'Support Ticket',
    description:
      'Support template: triage incoming tickets, decide if issue category is known, resolve with knowledge base when possible, and escalate specialist cases before closure.',
    lines: [
      'Start: Customer submits ticket',
      'Triage request',
      'Decision: Is issue category identified?',
      'Resolve with knowledge base',
      'Escalate to specialist',
      'End: Ticket closed',
    ],
  },
  {
    id: 'onboarding',
    tab: 'Onboarding',
    label: 'Customer Onboarding',
    description:
      'Onboarding template: capture setup requirements, provision account access, validate readiness, and complete enablement before go-live.',
    lines: [
      'Start: Customer signs agreement',
      'Collect setup requirements',
      'Provision account',
      'Decision: Is setup validated?',
      'Run enablement session',
      'End: Customer live',
    ],
  },
  {
    id: 'sales',
    tab: 'Sales',
    label: 'Sales Opportunity',
    description:
      'Sales template: qualify lead potential, confirm prospect fit, run discovery, and progress to proposal through close.',
    lines: [
      'Start: Lead created',
      'Qualify opportunity',
      'Decision: Is prospect qualified?',
      'Run discovery call',
      'Prepare proposal',
      'End: Opportunity closed',
    ],
  },
] as const

const GOLD_TOC_SEED_TEMPLATE = [
  'Cluster: Core Concepts & Account Management',
  'Cluster: User Data & Support Issues',
  'Cluster: Payments & Deposits',
  'Cluster: Withdrawals & Cashier',
  'Cluster: Verification & Risk',
  'Cluster: Bonuses & Gamification',
  'Cluster: Sports Betting',
  'Cluster: Account Status & Safety',
].join('\n')

const CHAPTER_WITHDRAWAL_RAW_TEMPLATE = [
  '4.2 Processing a Withdrawal',
  'Finance tab baseline: initiated withdrawal appears as Pending.',
  'Statuses include Pending, Cancelled/Declined, Complete, and Awaiting (bug state requiring manual cancellation).',
  'Cancellation paths: player self-cancel in Cashier while Pending; KYC cancellation for wrong details/verification failures; CS escalation to SM/support channel on request.',
  'If first cancellation, advise resubmission with same method, Bank Transfer, or different method with minimum deposit + x1 wager.',
  'If second/third cancellation, escalate to finance for manual KYC check and tell player to wait for email.',
  'Processing SLA: finance handles within 3 business days, 10:00-18:00 (+2 GMT), excluding weekends.',
  'Progression guidance: pending <=3 days (queue reassurance), pending >3 days (empathy + delay reassurance), complete 3-5 days (bank settlement notice), complete >5 days (request ARN via finance Slack).',
  'ARN is provided to the player for bank tracking; agents cannot track it directly.',
].join('\n')

const CHAPTER_WITHDRAWAL_GOLD_TEMPLATE = [
  'Start: Player submits withdrawal request.',
  'Check withdrawal status in Finance tab.',
  'Decision: Is status Pending and under 3 business days?',
  'Inform player withdrawal is in queue and within normal processing time.',
  'Decision: Is status Pending longer than 3 business days?',
  'Acknowledge delay, reassure funds are safe, and apologize.',
  'Decision: Is status Complete and fewer than 5 business days since payout?',
  'Inform player funds were sent and bank settlement may take 3-5 business days.',
  'Decision: Is status Complete and more than 5 business days since payout?',
  'Escalate to finance for ARN request and tell player update will come by email.',
  'Decision: Is status Awaiting?',
  'Cancel manually and ask player to submit withdrawal again.',
  'Decision: Is cancellation requested while status is Pending?',
  'Guide self-cancel in Cashier; if impossible escalate to SM/support channel.',
  'End: Withdrawal case resolved or escalated.',
].join('\n')

const CHAPTER_CASHBACK_RAW_TEMPLATE = [
  '6.3 Cashback Weekly / Live Casino Cashback',
  'Cashback is a real-balance cash bonus based on percentage of losses and subject to 1x wagering.',
  'Types include Weekly cashback and Daily cashback (special VIP offer).',
  'Weekly Casino cashback is based on slot losses, credited Monday, minimum 5 EUR, VIP levels 3/4/5 only.',
  'VIP percentages: Gold 5%, Platinum 10%, Diamond 15%.',
  'Weekly Live Casino cashback is 25%, based on Live Casino losses only, credited Monday, minimum 5 EUR, available to all account levels.',
  'Agents must confirm which cashback promo the player means and check logs for auto-credit.',
  'Automated weekly cashback may be credited at 07:00 CY/BG time; on NR1 players activate from Bonuses section.',
  'Agents can advise players to OPT-IN weekly; opting in any day still applies for following Monday.',
].join('\n')

const CHAPTER_CASHBACK_GOLD_TEMPLATE = [
  'Start: Player contacts support to claim cashback.',
  'Confirm which cashback promotion the player is referring to.',
  'Decision: Is this Weekly Casino cashback?',
  'Check slot losses from prior week and minimum 5 EUR threshold.',
  'Decision: Is player VIP level 3, 4, or 5?',
  'Apply cashback percentage by level (Gold 5%, Platinum 10%, Diamond 15%).',
  'Decision: Is this Weekly Live Casino cashback?',
  'Check live casino losses only and apply 25% cashback if minimum threshold is met.',
  'Check logs for automated cashback credit at 07:00 CY/BG.',
  'If auto-credited, guide player to activate bonus from bonuses section.',
  'Advise player to OPT-IN for weekly cashback going forward.',
  'End: Cashback request resolved and player informed.',
].join('\n')

const CHAPTER_REOPENING_RAW_TEMPLATE = [
  '8.1 Account Reopening',
  'Players cannot reopen accounts themselves; requests come via chat/email and can be approved or denied.',
  'Deny reasons include duplicate account, fraud, underage, GDPR, self-harm/complaints/care-listed.',
  'Teams decide reopening path: casino escalates to support channel, sports escalates to sports channel.',
  'Only SM can complete reopening for standard closure requests.',
  'For denied requests, a mandatory log must state why denied.',
  'After GA closure: ask responsible gambling confirmation question (T&C 4.1), escalate to SM, reopen after confirmation, send RG tools template.',
  'If account is frozen after repeated failed logins, agent can reopen directly: status Open, reopen bonus program, save, leave log.',
  'Offer password reset when player requests it.',
].join('\n')

const CHAPTER_REOPENING_GOLD_TEMPLATE = [
  'Start: Player requests account reopening via chat or email.',
  'Check closure reason in account logs.',
  'Decision: Is closure reason in deny list (duplicate, fraud, underage, GDPR, self-harm/care)?',
  'Deny reopening request and log explicit denial reason.',
  'Decision: Is player casino or sports?',
  'Escalate casino to support channel; escalate sports to sports channel.',
  'Decision: Is request after GA closure?',
  'Ask T&C 4.1 responsible-gambling confirmation question.',
  'Escalate to SM for reopen decision.',
  'If approved, SM reopens account and agent sends RG tools template.',
  'Decision: Is account frozen due to failed login attempts?',
  'Reopen directly by setting status Open, reopening bonus program, saving changes, and leaving a log.',
  'Offer password reset if needed.',
  'End: Account reopened or denied with documented reason.',
].join('\n')

const IMPORT_TEST_TEMPLATES = [
  {
    id: 'gold-toc-seed',
    label: 'Gold TOC Seed',
    mode: 'text' as const,
    payload: GOLD_TOC_SEED_TEMPLATE,
  },
  {
    id: 'wd-4-2-raw',
    label: '4.2 WD Raw',
    mode: 'ai' as const,
    payload: CHAPTER_WITHDRAWAL_RAW_TEMPLATE,
  },
  {
    id: 'wd-4-2-gold',
    label: '4.2 WD Gold',
    mode: 'text' as const,
    payload: CHAPTER_WITHDRAWAL_GOLD_TEMPLATE,
  },
  {
    id: 'cb-6-3-raw',
    label: '6.3 CB Raw',
    mode: 'ai' as const,
    payload: CHAPTER_CASHBACK_RAW_TEMPLATE,
  },
  {
    id: 'cb-6-3-gold',
    label: '6.3 CB Gold',
    mode: 'text' as const,
    payload: CHAPTER_CASHBACK_GOLD_TEMPLATE,
  },
  {
    id: 'ar-8-1-raw',
    label: '8.1 AR Raw',
    mode: 'ai' as const,
    payload: CHAPTER_REOPENING_RAW_TEMPLATE,
  },
  {
    id: 'ar-8-1-gold',
    label: '8.1 AR Gold',
    mode: 'text' as const,
    payload: CHAPTER_REOPENING_GOLD_TEMPLATE,
  },
] as const

const BLANK_TEMPLATE_DESCRIPTION =
  'Blank template: start from an empty map and describe your process goals, actors, and expected outcomes.'

const AI_PLACEHOLDER =
  'Type draft text (notes or extract). Use → to generate, or top-right Import draft to apply adapters.'

const NODE_TYPE_OPTIONS: Array<{
  value: FlowNode['type']
  label: string
  desc: string
}> = [
  { value: 'process', label: 'Process', desc: 'Action step' },
  { value: 'decision', label: 'Decision', desc: 'Branch logic' },
  { value: 'terminal', label: 'Terminal', desc: 'Start/end point' },
  { value: 'data', label: 'Data / System', desc: 'Integration' },
  { value: 'annotation', label: 'Annotation', desc: 'Context note' },
]

const EDGE_OPTIONS: Array<{ value: EdgeType; label: string; lineHint: string; arrowHint: string }> = [
  { value: 'sequential', label: 'Sequential', lineHint: 'Solid line', arrowHint: 'Closed arrow' },
  { value: 'conditional', label: 'Conditional', lineHint: 'Dashed line', arrowHint: 'Diamond arrow' },
  { value: 'parallel', label: 'Parallel', lineHint: 'Dotted line', arrowHint: 'Double arrow' },
  { value: 'fallback', label: 'Fallback', lineHint: 'Long-dash line', arrowHint: 'Open arrow' },
]

const ACTOR_OPTIONS: Array<{ value: Actor; label: string }> = [
  { value: '', label: 'Unassigned' },
  { value: 'customer', label: 'Customer' },
  { value: 'agent', label: 'Agent' },
  { value: 'system', label: 'System' },
  { value: 'manager', label: 'Manager' },
  { value: 'external', label: 'External' },
]

const MAP_PHASE_NAMES = ['Discover', 'Consider', 'Onboard', 'Use', 'Resolve', 'Retain']
const PALETTE_NODE_MIME = 'application/flowcraft-node-type'

const FEATURE_AVAILABILITY = {
  templates: true,
  aiAssist: true,
  importJson: true,
} as const

const PREP_FEATURE_FLAGS = {
  importMapClustersLayer: true,
} as const

const IMPORT_QA_PRESETS_ENABLED = true

type EdgeMode = 'auto' | 'manual'
type CanvasTool = 'select' | 'connect'
type StructureCluster = 'projects' | 'artifacts' | 'versions' | null
type DraftSourceType = 'text' | 'document'
type ImportStage = 'toc_seed' | 'detail_ingest' | 'review' | 'confirmed'
type DocMapFilter = 'all' | ImportDocumentBlockType
type ExternalAssistProvider = 'none' | 'gemini' | 'copilot'
type GeminiAssistMode = 'toc_seed' | 'detail_steps' | 'ocr_cleanup'

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

function textFromStructuredGeminiPayload(payload: GeminiStructuredPayload): string {
  if (payload.sections.length === 0) return payload.cleanedText.trim()
  return payload.sections
    .flatMap((section) => [
      `# ${section.title}`,
      ...section.steps.map((step) => {
        const prefix = `[${step.kind}]`
        return step.notes ? `${prefix} ${step.title}; ${step.notes}` : `${prefix} ${step.title}`
      }),
    ])
    .join('\n')
    .trim()
}

const DOCMAP_FILTER_OPTIONS: Array<{ id: DocMapFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'context', label: 'Context' },
  { id: 'process', label: 'Process' },
  { id: 'subprocess', label: 'Subprocess' },
  { id: 'fact', label: 'Fact' },
  { id: 'unclassified', label: 'Unclassified' },
]

const GEMINI_ASSIST_MODE_OPTIONS: Array<{ id: GeminiAssistMode; label: string }> = [
  { id: 'toc_seed', label: 'TOC -> Clusters' },
  { id: 'detail_steps', label: 'Chapter -> Steps' },
  { id: 'ocr_cleanup', label: 'OCR cleanup only' },
]

const IMPORT_STAGE_STEPS: Array<{
  id: ImportStage
  label: string
  hint: string
}> = [
  {
    id: 'toc_seed',
    label: 'Seed Clusters',
    hint: 'Paste TOC text and shape top-level clusters/phases.',
  },
  {
    id: 'detail_ingest',
    label: 'Ingest Detail Docs',
    hint: 'Import detailed text/documents into seeded clusters.',
  },
  {
    id: 'review',
    label: 'Review & Refine',
    hint: 'Edit assignments and clean flow connections in Import Map.',
  },
  {
    id: 'confirmed',
    label: 'Confirm & Exit',
    hint: 'Finalize import and continue in Journey Flow.',
  },
]

const UI_STORAGE_KEYS = {
  structureOpen: 'flowcraft.ui.structureOpen',
  previewOpen: 'flowcraft.ui.previewOpen',
  structureCluster: 'flowcraft.ui.structureCluster',
  edgeMode: 'flowcraft.ui.edgeMode',
  sidebarVisible: 'flowcraft.ui.sidebarVisible',
  inspectorVisible: 'flowcraft.ui.inspectorVisible',
  externalAssistProvider: 'flowcraft.ui.externalAssistProvider',
  geminiModel: 'flowcraft.ui.geminiModel',
  geminiAssistMode: 'flowcraft.ui.geminiAssistMode',
} as const

function readStoredBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw === null) return fallback
  return raw === '1'
}

function writeStoredBool(key: string, value: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, value ? '1' : '0')
}

function readStoredExternalAssistProvider(): ExternalAssistProvider {
  if (typeof window === 'undefined') return 'none'
  const raw = window.localStorage.getItem(UI_STORAGE_KEYS.externalAssistProvider)
  return raw === 'gemini' || raw === 'copilot' ? raw : 'none'
}

function readStoredGeminiModel(): string {
  if (typeof window === 'undefined') return 'gemini-2.5-flash'
  const raw = window.localStorage.getItem(UI_STORAGE_KEYS.geminiModel)
  return raw?.trim() || 'gemini-2.5-flash'
}

function readStoredGeminiAssistMode(): GeminiAssistMode {
  if (typeof window === 'undefined') return 'detail_steps'
  const raw = window.localStorage.getItem(UI_STORAGE_KEYS.geminiAssistMode)
  if (raw === 'toc_seed' || raw === 'detail_steps' || raw === 'ocr_cleanup') return raw
  return 'detail_steps'
}

function readStoredStructureCluster(): StructureCluster {
  if (typeof window === 'undefined') return 'projects'
  const raw = window.localStorage.getItem(UI_STORAGE_KEYS.structureCluster)
  if (raw === 'projects' || raw === 'artifacts' || raw === 'versions') return raw
  return 'projects'
}

function readStoredEdgeMode(): EdgeMode {
  if (typeof window === 'undefined') return 'auto'
  const raw = window.localStorage.getItem(UI_STORAGE_KEYS.edgeMode)
  return raw === 'manual' ? 'manual' : 'auto'
}

function actorText(actor: Actor) {
  if (!actor) return 'unassigned'
  return actor
}

function actorLabel(actor: Actor) {
  if (!actor) return 'Unassigned'
  return actor.charAt(0).toUpperCase() + actor.slice(1)
}

function reviewOptions(): ReviewState[] {
  return ['draft', 'in_review', 'approved', 'rejected']
}

function terminalRole(node: FlowNode): 'start' | 'end' | null {
  if (node.type !== 'terminal') return null
  const label = node.label.trim().toLowerCase()
  if (label.startsWith('start')) return 'start'
  if (label.startsWith('end') || label.startsWith('close') || label.startsWith('closed')) return 'end'
  return null
}

function splitLegacyNodeCopy(label: string): { title: string; note: string } {
  const normalized = label.trim()
  if (!normalized) return { title: 'Untitled step', note: '' }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length >= 2) {
    return {
      title: lines[0],
      note: lines.slice(1).join(' '),
    }
  }

  const byDelimiter = normalized.match(/^(.{10,90}?)(?:\s*;\s+|\s+[-–—]\s+)(.+)$/)
  if (byDelimiter) {
    return {
      title: byDelimiter[1].trim(),
      note: byDelimiter[2].trim(),
    }
  }

  if (normalized.length <= 72) return { title: normalized, note: '' }
  const splitIndex = normalized.lastIndexOf(' ', 72)
  if (splitIndex <= 20) {
    return { title: normalized.slice(0, 72).trim(), note: normalized.slice(72).trim() }
  }
  return {
    title: normalized.slice(0, splitIndex).trim(),
    note: normalized.slice(splitIndex + 1).trim(),
  }
}

function deriveNodeCopy(node: FlowNode): { title: string; note: string } {
  const title = node.label.trim() || 'Untitled step'
  const notes = node.metadata.notes?.trim() ?? ''
  if (notes) return { title, note: notes }
  return splitLegacyNodeCopy(title)
}

function inferEdgeType(
  sourceNode: FlowNode | undefined,
  targetNode: FlowNode | undefined,
  fallbackType: EdgeType,
): EdgeType {
  if (!sourceNode || !targetNode) return fallbackType
  if (sourceNode.type === 'decision') return 'conditional'
  if (targetNode.type === 'annotation') return 'fallback'
  if (sourceNode.type === 'data' || targetNode.type === 'data') return 'parallel'
  return 'sequential'
}

function sanitizeHtmlText(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectDocumentMapTypeFromClasses(className: string): ImportDocumentBlockType {
  const normalized = className.toLowerCase()
  if (
    normalized.includes('context_process_category') ||
    normalized.includes('c-context') ||
    normalized.includes('context')
  ) {
    return 'context'
  }
  if (normalized.includes('c-subprocess') || normalized.includes('subprocess')) return 'subprocess'
  if (normalized.includes('c-process') || normalized.includes('process')) return 'process'
  if (normalized.includes('c-fact') || normalized.includes('fact')) return 'fact'
  return 'unclassified'
}

function parseConfidenceFromText(raw: string): number | null {
  const match = raw.match(/[0-9]+(?:\.[0-9]+)?/)
  if (!match) return null
  const value = Number(match[0])
  if (Number.isNaN(value)) return null
  return Math.max(0, Math.min(1, value))
}

function parseDocumentMapHtml(input: string, sourceLabel: string): ImportDocumentMap | null {
  const trimmed = input.trim()
  if (!trimmed || !/<html[\s>]/i.test(trimmed)) return null
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return null

  const parser = new DOMParser()
  const doc = parser.parseFromString(trimmed, 'text/html')
  const title =
    sanitizeHtmlText(
      doc.querySelector('.header-title')?.textContent ||
        doc.querySelector('title')?.textContent ||
        'Imported document map',
    ) || 'Imported document map'

  const pageCards = Array.from(doc.querySelectorAll('.page-card'))
  const blocks: ImportDocumentBlock[] = []

  pageCards.forEach((card, cardIndex) => {
    const pageText = sanitizeHtmlText(card.querySelector('.page-num')?.textContent || '')
    const pageNumber = Number(pageText.match(/[0-9]+/)?.[0] ?? cardIndex + 1)
    const blockNodes = Array.from(card.querySelectorAll('.block'))
    blockNodes.forEach((blockNode, blockIndex) => {
      const interpreted = sanitizeHtmlText(blockNode.querySelector('.block-interpreted')?.textContent || '')
      const excerpt = sanitizeHtmlText(blockNode.querySelector('.block-excerpt')?.textContent || '')
      const confidence = parseConfidenceFromText(
        sanitizeHtmlText(blockNode.querySelector('.conf')?.textContent || ''),
      )
      const signals = Array.from(blockNode.querySelectorAll('.signal'))
        .map((node) => sanitizeHtmlText(node.textContent || ''))
        .filter(Boolean)
      const type = detectDocumentMapTypeFromClasses(blockNode.className)
      if (!interpreted && !excerpt && signals.length === 0) return
      blocks.push({
        id: `dm-${pageNumber}-${blockIndex + 1}`,
        page: Number.isFinite(pageNumber) ? pageNumber : cardIndex + 1,
        type,
        interpreted: interpreted || `Block ${blocks.length + 1}`,
        excerpt,
        confidence,
        signals,
      })
    })
  })

  if (blocks.length === 0) return null
  const pageCountFromMeta = Number(
    sanitizeHtmlText(doc.querySelector('.header-meta')?.textContent || '').match(/([0-9]+)\s+pages?/i)?.[1] ?? 0,
  )
  const pageCount =
    pageCountFromMeta > 0 ? pageCountFromMeta : Math.max(...blocks.map((block) => block.page), 1)

  return {
    id: `docmap_${Math.random().toString(36).slice(2, 10)}`,
    title,
    sourceLabel,
    pageCount,
    blocks,
    createdAt: new Date().toISOString(),
  }
}

function normalizeOcrText(input: string): string {
  if (!input.trim()) return ''
  const merged = input
    .replace(/\r\n/g, '\n')
    .replace(/([a-z0-9]),\n([a-z0-9])/gi, '$1, $2')
    .replace(/([a-z0-9])-\n([a-z0-9])/gi, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
  const lines = merged
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, idx, arr) => {
      if (!line) return idx > 0 && arr[idx - 1] !== ''
      return true
    })

  const stitched: string[] = []
  for (const line of lines) {
    if (!stitched.length) {
      stitched.push(line)
      continue
    }
    const prev = stitched[stitched.length - 1]
    const isHeading = /^[0-9]+(\.[0-9]+)*\s+/.test(line) || /^[A-Z][A-Z\s&/-]{6,}$/.test(line)
    const startsBullet = /^([•\-*]|[0-9]+\.)\s+/.test(line)
    const prevEndsSentence = /[.:;!?"]$/.test(prev)
    if (!isHeading && !startsBullet && !prevEndsSentence) {
      stitched[stitched.length - 1] = `${prev} ${line}`.replace(/\s+/g, ' ').trim()
    } else {
      stitched.push(line)
    }
  }

  return stitched.join('\n').trim()
}

function guessGeminiAssistMode(text: string): GeminiAssistMode {
  const trimmed = text.trim()
  if (!trimmed) return 'detail_steps'
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const clusterLines = lines.filter((line) => /^cluster\s*:/i.test(line))
  if (clusterLines.length >= 2) return 'toc_seed'
  return 'detail_steps'
}

async function callGeminiViaProxy(params: {
  model: string
  mode: GeminiAssistMode
  source: string
}): Promise<
  | {
      ok: true
      text: string
      mode?: GeminiAssistMode
      warnings: string[]
      structured: GeminiStructuredPayload | null
    }
  | { ok: false; error: string }
> {
  const response = await fetch('/api/gemini/assist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })

  const payload = (await response.json().catch(() => ({}))) as {
    text?: string
    error?: string
    mode?: GeminiAssistMode
    warnings?: unknown
    structured?: unknown
  }

  if (!response.ok) {
    return {
      ok: false,
      error: payload.error || `Gemini proxy failed (${response.status}).`,
    }
  }

  const text = (payload.text ?? '').trim()
  if (!text) {
    return { ok: false, error: 'Gemini proxy returned empty content.' }
  }
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((value): value is string => typeof value === 'string')
    : []
  const structured =
    payload.structured && typeof payload.structured === 'object'
      ? (payload.structured as GeminiStructuredPayload)
      : null
  return { ok: true, text, mode: payload.mode, warnings, structured }
}

function normalizeDocMapText(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function blockMatchesModel(block: ImportDocumentBlock, model: CanonicalModel | null): boolean {
  if (!model) return false
  const interpreted = normalizeDocMapText(block.interpreted)
  const excerpt = normalizeDocMapText(block.excerpt)
  const needles = [interpreted, excerpt]
    .filter((value) => value.length > 0)
    .flatMap((value) => value.split(' ').filter((token) => token.length >= 4))
    .slice(0, 10)
  if (needles.length === 0) return false

  return model.nodes.some((node) => {
    const hay = normalizeDocMapText(`${node.label} ${node.metadata.notes ?? ''}`)
    return needles.some((needle) => hay.includes(needle))
  })
}

function isFlowCanvasTab(tab: 'flow' | 'import_map' | 'map') {
  return tab === 'flow'
}

function FlowNodeView({ data }: NodeProps<Node<RFNodeData>>) {
  return (
    <div
      className={`fnode-card kind-${data.kind} ${data.terminalRole ? `terminal-${data.terminalRole}` : ''}`}
      title={data.label}
    >
      <div className={`fnode-status-dot status-${data.status}`} />
      <div className="fnode-label">
        <div className="fnode-title">{data.title}</div>
        {data.note && <div className="fnode-note">{data.note}</div>}
      </div>
      <div className="fnode-meta">
        <span className={`actor-pill actor-${actorText(data.actor)}`}>{actorLabel(data.actor)}</span>
      </div>
      <Handle type="target" position={Position.Top} className="flow-handle top" />
      <Handle type="source" position={Position.Bottom} className="flow-handle bottom" />
      <Handle type="target" position={Position.Left} className="flow-handle left" />
      <Handle type="source" position={Position.Right} className="flow-handle right" />
    </div>
  )
}

function toRFNode(node: FlowNode): Node<RFNodeData> {
  const copy = deriveNodeCopy(node)
  return {
    id: node.id,
    position: node.position,
    type: 'workflowNode',
    data: {
      label: copy.note ? `${copy.title}\n${copy.note}` : copy.title,
      title: copy.title,
      note: copy.note,
      actor: node.actor,
      kind: node.type,
      status: node.status,
      terminalRole: terminalRole(node),
    },
  }
}

function toRFEdge(edge: FlowEdge): Edge {
  const stroke = edgeStroke(edge.type)
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    animated: edge.type === 'parallel',
    className: `flow-edge edge-${edge.type}`,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: stroke,
      width: 16,
      height: 16,
    },
    style: {
      stroke,
      strokeWidth: 1.7,
      strokeDasharray: edge.type === 'fallback' ? '6 4' : undefined,
    },
    labelStyle: {
      fill: stroke,
      fontSize: 10,
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: '#f8f9fb',
      fillOpacity: 0.9,
    },
  }
}

function EdgeTypePreview({ type }: { type: EdgeType }) {
  const stroke = edgeStroke(type)
  const lineDash =
    type === 'conditional'
      ? '6 4'
      : type === 'parallel'
        ? '2 3'
        : type === 'fallback'
          ? '10 5'
          : undefined

  return (
    <svg className="ct-preview-svg" viewBox="0 0 44 14" aria-hidden>
      <line
        x1="2"
        y1="7"
        x2="30"
        y2="7"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={lineDash}
      />
      {type === 'conditional' && (
        <polygon points="36,7 33,4 30,7 33,10" fill={stroke} />
      )}
      {type === 'parallel' && (
        <>
          <polygon points="31,7 27,4 27,10" fill={stroke} />
          <polygon points="37,7 33,4 33,10" fill={stroke} />
        </>
      )}
      {type === 'fallback' && (
        <polyline
          points="30,4 36,7 30,10"
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {type === 'sequential' && (
        <polygon points="38,7 31,3 31,11" fill={stroke} />
      )}
    </svg>
  )
}

export default function App() {
  const {
    projects,
    selectedProjectId,
    artifacts,
    selectedArtifactId,
    selectedVersionId,
    selectedTab,
    selectedNodeId,
    selectedEdgeId,
    history,
    historyIndex,
    createProject,
    deleteProject,
    selectProject,
    createArtifact,
    selectArtifact,
    createVersion,
    selectVersion,
    setTab,
    updateNodeLabel,
    updateNodeNotes,
    updateNodeActor,
    updateEdgeLabel,
    updateEdgeType,
    setVersionReviewState,
    runValidation,
    importFromText,
    importFromDocument,
    importFromAiAssist,
    clearCurrentVersion,
    setImportDocumentMapForSelectedVersion,
    getImportDocumentMapsForSelectedVersion,
    importFromJson,
    recordExportForSelectedVersion,
    getExportHistoryForSelectedVersion,
    getReviewAuditTrail,
    addNodeToCurrentVersion,
    addEdgeToCurrentVersion,
    removeNodeFromCurrentVersion,
    removeEdgeFromCurrentVersion,
    updateCurrentVersionLayoutFromRF,
    selectNode,
    selectEdge,
    undoCurrentVersion,
    getCurrentModel,
  } = usePMStore()

  const [activeTemplate, setActiveTemplate] = useState<(typeof TEMPLATE_TABS)[number]>('Support')
  const [activeEdgeType, setActiveEdgeType] = useState<EdgeType>('sequential')
  const [edgeMode, setEdgeMode] = useState<EdgeMode>(() => readStoredEdgeMode())
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('select')
  const [draftSourceType, setDraftSourceType] = useState<DraftSourceType>('text')
  const [externalAssistProvider, setExternalAssistProvider] = useState<ExternalAssistProvider>(
    () => readStoredExternalAssistProvider(),
  )
  const [geminiModel, setGeminiModel] = useState(() => readStoredGeminiModel())
  const [geminiAssistMode, setGeminiAssistMode] = useState<GeminiAssistMode>(() =>
    readStoredGeminiAssistMode(),
  )
  const [externalAssistBusy, setExternalAssistBusy] = useState(false)
  const [docMapTargetKind, setDocMapTargetKind] = useState<ImportDocumentMapKind>('importedMap')
  const [docMapContentFilter, setDocMapContentFilter] = useState<DocMapFilter>('all')
  const [docMapImportedFilter, setDocMapImportedFilter] = useState<DocMapFilter>('all')
  const [docMapPanelsCollapsed, setDocMapPanelsCollapsed] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [qaBusy, setQaBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [headerNotice, setHeaderNotice] = useState('')
  const [importStage, setImportStage] = useState<ImportStage>('toc_seed')
  const [importMapPhasesCollapsed, setImportMapPhasesCollapsed] = useState(true)
  const [aiAssistExpanded, setAiAssistExpanded] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(() =>
    readStoredBool(UI_STORAGE_KEYS.sidebarVisible, true),
  )
  const [inspectorVisible, setInspectorVisible] = useState(() =>
    readStoredBool(UI_STORAGE_KEYS.inspectorVisible, true),
  )
  const [structureOpen, setStructureOpen] = useState(() =>
    readStoredBool(UI_STORAGE_KEYS.structureOpen, true),
  )
  const [previewOpen, setPreviewOpen] = useState(() =>
    readStoredBool(UI_STORAGE_KEYS.previewOpen, false),
  )
  const [activeStructureCluster, setActiveStructureCluster] = useState<StructureCluster>(() =>
    readStoredStructureCluster(),
  )
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance<Node<RFNodeData>, Edge> | null>(
    null,
  )
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  const projectArtifacts = useMemo(
    () => artifacts.filter((a) => a.projectId === selectedProjectId),
    [artifacts, selectedProjectId],
  )

  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId],
  )

  const versions = selectedArtifact?.versions ?? []
  const selectedVersion = selectedArtifact?.versions.find((v) => v.id === selectedVersionId) ?? null

  const currentModel = useMemo(() => {
    if (!selectedArtifact || !selectedVersionId) return null
    const version = selectedArtifact.versions.find((v) => v.id === selectedVersionId)
    return version?.data ?? null
  }, [selectedArtifact, selectedVersionId])

  const validation = currentModel?.validation ?? []
  const selectedNode = currentModel?.nodes.find((n) => n.id === selectedNodeId) ?? null
  const selectedEdge = currentModel?.edges.find((e) => e.id === selectedEdgeId) ?? null

  const rfNodeSeed = useMemo(
    () => (currentModel ? currentModel.nodes.map(toRFNode) : []),
    [currentModel],
  )
  const rfEdgeSeed = useMemo(
    () => (currentModel ? currentModel.edges.map(toRFEdge) : []),
    [currentModel],
  )
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(rfNodeSeed)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(rfEdgeSeed)
  const nodeTypes = useMemo(() => ({ workflowNode: FlowNodeView }), [])
  const reviewAuditTrail = useMemo(
    () => (selectedVersion ? getReviewAuditTrail().slice(-8) : []),
    [getReviewAuditTrail, selectedVersion],
  )
  const exportHistory = useMemo(
    () => (selectedVersion ? getExportHistoryForSelectedVersion().slice(-8).reverse() : []),
    [getExportHistoryForSelectedVersion, selectedVersion],
  )

  useEffect(() => {
    setRfNodes(rfNodeSeed)
    setRfEdges(rfEdgeSeed)
  }, [rfNodeSeed, rfEdgeSeed, setRfNodes, setRfEdges])

  useEffect(() => {
    writeStoredBool(UI_STORAGE_KEYS.structureOpen, structureOpen)
  }, [structureOpen])

  useEffect(() => {
    writeStoredBool(UI_STORAGE_KEYS.previewOpen, previewOpen)
  }, [previewOpen])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (activeStructureCluster) {
      window.localStorage.setItem(UI_STORAGE_KEYS.structureCluster, activeStructureCluster)
      return
    }
    window.localStorage.removeItem(UI_STORAGE_KEYS.structureCluster)
  }, [activeStructureCluster])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(UI_STORAGE_KEYS.edgeMode, edgeMode)
  }, [edgeMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    writeStoredBool(UI_STORAGE_KEYS.sidebarVisible, sidebarVisible)
  }, [sidebarVisible])

  useEffect(() => {
    if (typeof window === 'undefined') return
    writeStoredBool(UI_STORAGE_KEYS.inspectorVisible, inspectorVisible)
  }, [inspectorVisible])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(UI_STORAGE_KEYS.externalAssistProvider, externalAssistProvider)
  }, [externalAssistProvider])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(UI_STORAGE_KEYS.geminiModel, geminiModel)
  }, [geminiModel])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(UI_STORAGE_KEYS.geminiAssistMode, geminiAssistMode)
  }, [geminiAssistMode])

  useEffect(() => {
    if (!sidebarVisible && aiAssistExpanded) setAiAssistExpanded(false)
  }, [sidebarVisible, aiAssistExpanded])

  useEffect(() => {
    setImportStage('toc_seed')
  }, [selectedVersionId])

  const canUndo = history.length > 1 && historyIndex > 0

  const mapActorBuckets = useMemo(() => {
    const nodes = currentModel?.nodes ?? []
    const actorOrder: Actor[] = ['customer', 'agent', 'system', 'manager', 'external', '']
    return actorOrder
      .map((actor) => ({
        actor: actor || 'unassigned',
        label: actorLabel(actor),
        items: nodes
          .filter((node) => node.actor === actor)
          .sort((a, b) => a.position.x - b.position.x),
      }))
      .filter((bucket) => bucket.items.length > 0)
  }, [currentModel])

  const mapChapters = useMemo(() => {
    const nodes = [...(currentModel?.nodes ?? [])].sort((a, b) => a.position.x - b.position.x)
    if (nodes.length === 0) return []

    const stageMap = new Map<string, FlowNode[]>()
    nodes.forEach((node) => {
      const stage = node.metadata.stage?.trim()
      if (!stage) return
      const list = stageMap.get(stage) ?? []
      list.push(node)
      stageMap.set(stage, list)
    })

    if (stageMap.size >= 2) {
      return [...stageMap.entries()].map(([stage, stageNodes], index) => {
        const previewLabels = stageNodes.slice(0, 2).map((node) => node.label)
        const extra = stageNodes.length - previewLabels.length
        const summary =
          previewLabels.length > 0
            ? `${previewLabels.join(' -> ')}${extra > 0 ? ` +${extra} more` : ''}`
            : 'No mapped steps'
        return {
          id: `stage-${index}`,
          title: stage,
          summary,
          count: stageNodes.length,
        }
      })
    }

    const chapterCount = Math.min(6, Math.max(2, Math.ceil(nodes.length / 2)))
    const chapterSize = Math.ceil(nodes.length / chapterCount)
    const chunks: Array<{ id: string; title: string; summary: string; count: number }> = []

    for (let index = 0; index < nodes.length; index += chapterSize) {
      const chunk = nodes.slice(index, index + chapterSize)
      const chapterIndex = chunks.length
      const title = MAP_PHASE_NAMES[chapterIndex] ?? `Chapter ${chapterIndex + 1}`
      const previewLabels = chunk.slice(0, 2).map((node) => node.label)
      const extra = chunk.length - previewLabels.length
      const summary =
        previewLabels.length > 0
          ? `${previewLabels.join(' -> ')}${extra > 0 ? ` +${extra} more` : ''}`
          : 'No mapped steps'
      chunks.push({
        id: `chapter-${chapterIndex}`,
        title,
        summary,
        count: chunk.length,
      })
    }

    return chunks
  }, [currentModel])

  const mapClusters = useMemo(() => {
    const nodes = currentModel?.nodes ?? []
    const seededClusterLabelsFromGroups =
      currentModel?.projections.map.groups
        ?.map((group) => group.label.trim())
        .filter((label) => label.length > 0) ?? []

    const seededClusterLabelsFromAnnotations = nodes
      .filter((node) => node.type === 'annotation')
      .map((node) => node.label.match(/^cluster\s*:\s*(.+)$/i)?.[1]?.trim() ?? node.label.trim())
      .filter((label) => label.length > 0)

    const seededClusterLabels = [...new Set([...seededClusterLabelsFromGroups, ...seededClusterLabelsFromAnnotations])]

    const stageBuckets = new Map<string, FlowNode[]>()
    nodes.forEach((node) => {
      const stage = node.metadata.stage?.trim()
      if (!stage || node.type === 'annotation') return
      const bucket = stageBuckets.get(stage) ?? []
      bucket.push(node)
      stageBuckets.set(stage, bucket)
    })

    const clusterOrder = seededClusterLabels.length > 0 ? [...seededClusterLabels] : [...stageBuckets.keys()]
    const missingAssignedClusters = [...stageBuckets.keys()].filter(
      (stage) => !clusterOrder.some((label) => label.toLowerCase() === stage.toLowerCase()),
    )
    const allClusters = [...clusterOrder, ...missingAssignedClusters]
    const entries = allClusters.map((name, index) => {
      const mappedSteps = stageBuckets.get(name) ?? []
      const preview = mappedSteps.slice(0, 2).map((node) => node.label)
      const extra = mappedSteps.length - preview.length
      return {
        id: `cluster-${index}`,
        name,
        count: mappedSteps.length,
        isEmpty: mappedSteps.length === 0,
        order: index,
        summary:
          mappedSteps.length === 0
            ? 'Cluster seeded. Waiting for detailed step allocation.'
            : `${preview.join(' -> ')}${extra > 0 ? ` +${extra} more` : ''}`,
      }
    })

    entries.sort((a, b) => {
      if (a.isEmpty !== b.isEmpty) return a.isEmpty ? 1 : -1
      if (!a.isEmpty && a.count !== b.count) return b.count - a.count
      return a.order - b.order
    })

    return entries
  }, [currentModel])

  function handleCreateProject() {
    const name = window.prompt('Project name', `Project ${projects.length + 1}`)
    if (!name) return
    createProject(name)
  }

  function handleCreateArtifact() {
    if (!selectedProjectId) return
    const name = window.prompt('Artifact name', `Artifact ${projectArtifacts.length + 1}`)
    if (!name) return
    createArtifact(selectedProjectId, name)
  }

  function handleCreateVersion() {
    if (!selectedArtifactId) return
    const name = window.prompt('Version name', `v${versions.length + 1}`)
    if (!name) return
    createVersion(selectedArtifactId, name)
  }

  function nodeLabel(type: FlowNode['type']) {
    return NODE_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? 'Node'
  }

  function handleAddNode(type: FlowNode['type']) {
    if (!currentModel) return
    const node = buildDefaultNode(currentModel.nodes.length, type)
    if (rfInstance && canvasWrapRef.current) {
      const rect = canvasWrapRef.current.getBoundingClientRect()
      node.position = rfInstance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
    }
    addNodeToCurrentVersion(node)
    if (!isFlowCanvasTab(selectedTab)) setTab('flow')
    setHeaderNotice(`${nodeLabel(type)} node added. Drag it or connect from handles.`)
  }

  function handlePaletteDragStart(event: DragEvent<HTMLButtonElement>, type: FlowNode['type']) {
    if (!selectedVersion) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData(PALETTE_NODE_MIME, type)
    event.dataTransfer.effectAllowed = 'copy'
  }

  function handleCanvasDragOver(event: DragEvent<HTMLDivElement>) {
    if (!selectedVersion || !isFlowCanvasTab(selectedTab)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleCanvasDrop(event: DragEvent<HTMLDivElement>) {
    if (!selectedVersion || !isFlowCanvasTab(selectedTab) || !rfInstance || !currentModel) return
    event.preventDefault()
    const rawType = event.dataTransfer.getData(PALETTE_NODE_MIME)
    if (!rawType) return
    const nodeType = NODE_TYPE_OPTIONS.some((option) => option.value === rawType)
      ? (rawType as FlowNode['type'])
      : 'process'
    const node = buildDefaultNode(currentModel.nodes.length, nodeType)
    node.position = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addNodeToCurrentVersion(node)
    setHeaderNotice(`${nodeLabel(nodeType)} node dropped on canvas.`)
  }

  function handleConnect(conn: Connection) {
    if (canvasTool !== 'connect') {
      setHeaderNotice('Switch to Connect mode in the bottom toolbar to create links.')
      return
    }
    if (!conn.source || !conn.target) return
    const edge = buildDefaultEdge(conn.source, conn.target)
    const sourceNode = currentModel?.nodes.find((node) => node.id === conn.source)
    const targetNode = currentModel?.nodes.find((node) => node.id === conn.target)
    edge.type = edgeMode === 'auto'
      ? inferEdgeType(sourceNode, targetNode, activeEdgeType)
      : activeEdgeType
    addEdgeToCurrentVersion(edge)
    setHeaderNotice(
      edgeMode === 'auto'
        ? `Connected with ${edge.type} (auto).`
        : `Connected with ${edge.type} (manual).`,
    )
  }

  function openStructureCluster(cluster: Exclude<StructureCluster, null>) {
    setActiveStructureCluster((current) => (current === cluster ? null : cluster))
  }

  function isStructureClusterOpen(cluster: Exclude<StructureCluster, null>) {
    return activeStructureCluster === cluster
  }

  function handleDeleteSelection() {
    if (selectedNodeId) {
      removeNodeFromCurrentVersion(selectedNodeId)
      return
    }
    if (selectedEdgeId) removeEdgeFromCurrentVersion(selectedEdgeId)
  }

  function handleSetCanvasTool(nextTool: CanvasTool) {
    setCanvasTool(nextTool)
    setHeaderNotice(
      nextTool === 'connect'
        ? 'Connect mode active. Drag from one node handle to another to create links.'
        : 'Select mode active. Click nodes or edges to edit, then use inspector or delete.',
    )
  }

  function handleCanvasToolbarUndo() {
    if (!canUndo) {
      setHeaderNotice('Nothing to undo yet.')
      return
    }
    undoCurrentVersion()
    setHeaderNotice('Undid last change.')
  }

  function handleCanvasToolbarDelete() {
    if (!selectedNodeId && !selectedEdgeId) {
      setHeaderNotice('Select a node or edge first.')
      return
    }
    handleDeleteSelection()
    setHeaderNotice('Deleted selected element.')
  }

  function handleValidateClick() {
    if (!currentModel) {
      setHeaderNotice('Select or create a version to validate.')
      return
    }
    const result = runValidation()
    const warnOrErrorCount = result.errors + result.warns
    setHeaderNotice(
      warnOrErrorCount === 0
        ? 'Validation passed. No issues found.'
        : `Validation found ${result.errors} error(s) and ${result.warns} warning(s).`,
    )
  }

  function downloadFile(fileName: string, contents: string, mimeType: string) {
    const blob = new Blob([contents], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function downloadBlob(fileName: string, blob: Blob) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function recordExportMetadata(format: ExportFormat, fileName: string, payload: string | Blob) {
    const bytes =
      typeof payload === 'string' ? new TextEncoder().encode(payload).byteLength : payload.size
    const checksum = await sha256Hex(payload)
    recordExportForSelectedVersion({
      format,
      fileName,
      mimeType: exportMimeType(format),
      sizeBytes: bytes,
      checksum,
    })
  }

  async function handleExportJson() {
    if (!currentModel) {
      setHeaderNotice('Nothing to export yet. Create or select a version first.')
      return
    }
    setExportBusy(true)
    try {
      const payload = toJsonExportString(currentModel)
      const roundtrip = verifyJsonRoundtripLossless(currentModel)
      if (!roundtrip.ok) {
        setHeaderNotice(`JSON export blocked: ${roundtrip.reason}`)
        return
      }
      const fileName = 'flowcraft-export.json'
      downloadFile(fileName, payload, exportMimeType('json'))
      await recordExportMetadata('json', fileName, payload)
      setHeaderNotice('Exported JSON successfully (lossless roundtrip verified).')
    } finally {
      setExportBusy(false)
    }
  }

  async function handleExportMermaid() {
    if (!currentModel) {
      setHeaderNotice('Nothing to export yet. Create or select a version first.')
      return
    }
    setExportBusy(true)
    try {
      const mermaid = toMermaidFlowchart(currentModel)
      const fileName = 'flowcraft-export.mmd'
      downloadFile(fileName, mermaid, exportMimeType('mermaid'))
      await recordExportMetadata('mermaid', fileName, mermaid)
      setHeaderNotice('Exported Mermaid flowchart successfully.')
    } finally {
      setExportBusy(false)
    }
  }

  async function handleExportSvg() {
    if (!currentModel) {
      setHeaderNotice('Nothing to export yet. Create or select a version first.')
      return
    }
    setExportBusy(true)
    try {
      const svg = toSvgSnapshot(currentModel)
      const fileName = 'flowcraft-export.svg'
      downloadFile(fileName, svg, exportMimeType('svg'))
      await recordExportMetadata('svg', fileName, svg)
      setHeaderNotice('Exported SVG snapshot successfully.')
    } finally {
      setExportBusy(false)
    }
  }

  async function handleExportPng() {
    if (!currentModel) {
      setHeaderNotice('Nothing to export yet. Create or select a version first.')
      return
    }
    setExportBusy(true)
    try {
      const width = 1400
      const height = 900
      const svg = toSvgSnapshot(currentModel, width, height)
      const pngBlob = await svgToPngBlob(svg, width, height)
      const fileName = 'flowcraft-export.png'
      downloadBlob(fileName, pngBlob)
      await recordExportMetadata('png', fileName, pngBlob)
      setHeaderNotice('Exported PNG snapshot successfully.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PNG export failed.'
      setHeaderNotice(message)
    } finally {
      setExportBusy(false)
    }
  }

  async function handleImportJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      setHeaderNotice('No file selected for JSON import.')
      return
    }
    setImportBusy(true)
    try {
      const raw = await file.text()
      const result = importFromJson(raw)
      setHeaderNotice(result.message)
    } finally {
      setImportBusy(false)
      event.target.value = ''
    }
  }

  function handleImportText() {
    const result = importFromText(aiPrompt)
    if (result.ok) {
      setAiPrompt('')
      setTab('import_map')
      if (importStage === 'toc_seed' || importStage === 'confirmed') {
        setImportStage('detail_ingest')
        setHeaderNotice(`${result.message} Proceed with detailed imports, then move to review.`)
        return
      }
    }
    setHeaderNotice(result.message)
  }

  function handleNormalizeOcrText() {
    const normalized = normalizeOcrText(aiPrompt)
    if (!normalized) {
      setHeaderNotice('Nothing to normalize. Paste OCR text first.')
      return
    }
    setAiPrompt(normalized)
    setHeaderNotice('OCR text normalized. Review and import.')
  }

  function handleClearTemplate() {
    const result = clearCurrentVersion()
    if (!result.ok) {
      setHeaderNotice(result.message)
      return
    }
    setActiveTemplate('Blank')
    setAiPrompt(BLANK_TEMPLATE_DESCRIPTION)
    setImportStage('toc_seed')
    setTab('import_map')
    setHeaderNotice(result.message)
  }

  function applyTemplateDescription(description: string) {
    setAiPrompt(description)
    setAiAssistExpanded(true)
    setSidebarVisible(true)
    if (importStage === 'confirmed') setImportStage('toc_seed')
  }

  function applyQuickImportTemplate(lines: readonly string[], label: string, description: string) {
    const payload = lines.join('\n')
    const result = importFromText(payload)
    applyTemplateDescription(description)
    if (result.ok) {
      setTab('import_map')
      if (importStage === 'toc_seed' || importStage === 'confirmed') {
        setImportStage('detail_ingest')
      }
    }
    setHeaderNotice(result.ok ? `${label} template loaded. ${result.message}` : result.message)
  }

  function handleApplyImportTestTemplate(
    template: (typeof IMPORT_TEST_TEMPLATES)[number],
  ) {
    if (!selectedVersion) {
      setHeaderNotice('Select or create a version before loading import test templates.')
      return
    }
    setAiPrompt(template.payload)
    setTab('import_map')
    if (template.id === 'gold-toc-seed') {
      setImportStage('toc_seed')
    }
    if (template.mode === 'text') {
      const result = importFromText(template.payload)
      if (result.ok && (importStage === 'toc_seed' || importStage === 'confirmed')) {
        setImportStage('detail_ingest')
      }
      setHeaderNotice(result.ok ? `${template.label} loaded. ${result.message}` : result.message)
      return
    }
    const result = importFromAiAssist(template.payload)
    if (result.ok && (importStage === 'toc_seed' || importStage === 'confirmed')) {
      setImportStage('detail_ingest')
    }
    setHeaderNotice(result.ok ? `${template.label} loaded. ${result.message}` : result.message)
  }

  function handleTemplateTabSelect(tab: (typeof TEMPLATE_TABS)[number]) {
    setActiveTemplate(tab)
    if (tab === 'Blank') {
      applyTemplateDescription(BLANK_TEMPLATE_DESCRIPTION)
    } else {
      const preset = QUICK_IMPORT_TEMPLATES.find((candidate) => candidate.id === tab.toLowerCase())
      if (preset) applyTemplateDescription(preset.description)
    }
    if (!selectedVersion) {
      setHeaderNotice('Select or create a version before loading templates.')
      return
    }
    if (tab === 'Blank') {
      setTab('import_map')
      setImportStage('toc_seed')
      setHeaderNotice('Blank template selected. Start shaping your import map manually.')
      return
    }
    const preset = QUICK_IMPORT_TEMPLATES.find((candidate) => candidate.id === tab.toLowerCase())
    if (!preset) {
      setHeaderNotice(`No preset found for ${tab}.`)
      return
    }
    applyQuickImportTemplate(preset.lines, preset.label, preset.description)
  }

  function handleImportDraftBySelectedSource() {
    if (draftSourceType === 'document') {
      handleImportDocumentFromDraft()
      return
    }
    handleImportText()
  }

  function handleImportDocumentFromDraft() {
    const result = importFromDocument(aiPrompt)
    if (result.ok) {
      setAiPrompt('')
      setTab('import_map')
      if (importStage === 'toc_seed' || importStage === 'confirmed') {
        setImportStage('detail_ingest')
        setHeaderNotice(`${result.message} Continue importing detail docs, then review in Import Map.`)
        return
      }
    }
    setHeaderNotice(result.message)
  }

  function docMapFilteredBlocks(map: ImportDocumentMap, filter: DocMapFilter): ImportDocumentBlock[] {
    if (filter === 'all') return map.blocks
    return map.blocks.filter((block) => block.type === filter)
  }

  function renderDocumentMapPanel(options: {
    kind: ImportDocumentMapKind
    map: ImportDocumentMap | null
    filter: DocMapFilter
    setFilter: (next: DocMapFilter) => void
  }) {
    const { kind, map, filter, setFilter } = options
    const heading = kind === 'contentMap' ? 'Content Map' : 'Imported Map'
    if (!map) {
      return (
        <section className="docmap-review">
          <div className="docmap-head">
            <strong>{heading}</strong>
            <span className="docmap-meta">No map loaded</span>
          </div>
          <div className="docmap-empty">
            Upload an HTML document map and set target to <strong>{heading}</strong> in Import options.
          </div>
        </section>
      )
    }
    const filteredBlocks = docMapFilteredBlocks(map, filter)
    const matchedCount = filteredBlocks.filter((block) => blockMatchesModel(block, currentModel)).length
    const lowConfidenceCount = filteredBlocks.filter(
      (block) => block.confidence !== null && block.confidence < 0.75,
    ).length
    const clusterCounts = filteredBlocks.reduce<Record<ImportDocumentBlockType, number>>(
      (acc, block) => {
        acc[block.type] += 1
        return acc
      },
      { context: 0, process: 0, subprocess: 0, fact: 0, unclassified: 0 },
    )
    return (
      <section className="docmap-review">
        <div className="docmap-head">
          <strong>{heading}</strong>
          <span className="docmap-meta">
            {map.title} · {map.pageCount} pages · {filteredBlocks.length}/{map.blocks.length} blocks
          </span>
        </div>
        <div className="docmap-filters">
          {DOCMAP_FILTER_OPTIONS.map((option) => (
            <button
              key={`${kind}-${option.id}`}
              type="button"
              className={`docmap-filter-btn ${filter === option.id ? 'active' : ''}`}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="docmap-grid">
          <section className="docmap-block-list">
            <h4>Blocks</h4>
            <div className="docmap-block-scroll">
              {filteredBlocks.length === 0 ? (
                <div className="docmap-empty">No blocks match the selected filter.</div>
              ) : (
                filteredBlocks.map((block) => {
                  const matched = blockMatchesModel(block, currentModel)
                  const low = block.confidence !== null && block.confidence < 0.75
                  return (
                    <article
                      key={`${kind}-${block.id}`}
                      className={`docmap-block-item ${low ? 'low-confidence' : ''} ${!matched ? 'unmatched' : ''}`}
                    >
                      <div className="docmap-block-row">
                        <span className={`docmap-pill type-${block.type}`}>{block.type}</span>
                        <span className="docmap-pill">p{block.page}</span>
                        <span className="docmap-pill conf">
                          {block.confidence === null ? 'n/a' : block.confidence.toFixed(2)}
                        </span>
                      </div>
                      <div className="docmap-title">{block.interpreted}</div>
                      {block.excerpt && <div className="docmap-excerpt">{block.excerpt}</div>}
                      {block.signals.length > 0 && (
                        <div className="docmap-signals">
                          {block.signals.map((signal, idx) => (
                            <span key={`${block.id}-signal-${idx}`} className="docmap-signal">
                              {signal}
                            </span>
                          ))}
                        </div>
                      )}
                    </article>
                  )
                })
              )}
            </div>
          </section>
          <section className="docmap-summary">
            <h4>Coverage</h4>
            <div className="docmap-summary-grid">
              <div className="docmap-summary-card">
                <div className="docmap-summary-label">Matched blocks</div>
                <div className="docmap-summary-value">{matchedCount}</div>
              </div>
              <div className="docmap-summary-card">
                <div className="docmap-summary-label">Unmatched blocks</div>
                <div className="docmap-summary-value">{Math.max(0, filteredBlocks.length - matchedCount)}</div>
              </div>
              <div className="docmap-summary-card">
                <div className="docmap-summary-label">Low confidence</div>
                <div className="docmap-summary-value">{lowConfidenceCount}</div>
              </div>
              <div className="docmap-summary-card">
                <div className="docmap-summary-label">Source</div>
                <div className="docmap-summary-value">{map.sourceLabel}</div>
              </div>
            </div>
            <div className="docmap-cluster-counts">
              {(Object.keys(clusterCounts) as ImportDocumentBlockType[]).map((type) => (
                <span key={`${kind}-count-${type}`} className="docmap-count-pill">
                  {type}: {clusterCounts[type]}
                </span>
              ))}
            </div>
          </section>
        </div>
      </section>
    )
  }

  async function handleImportDocumentFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setImportBusy(true)
    try {
      const content = await file.text()
      const payload = content.trim() || `Document: ${file.name}`
      const parsedMap = parseDocumentMapHtml(payload, file.name)
      if (parsedMap) {
        setImportDocumentMapForSelectedVersion(docMapTargetKind, parsedMap)
        setTab('import_map')
        setHeaderNotice(
          `${docMapTargetKind === 'contentMap' ? 'Content Map' : 'Imported Map'} loaded from HTML (${parsedMap.blocks.length} blocks).`,
        )
        return
      }

      const result = importFromDocument(payload)
      if (result.ok) {
        setTab('import_map')
        if (importStage === 'toc_seed' || importStage === 'confirmed') {
          setImportStage('detail_ingest')
          setHeaderNotice(`${result.message} Continue adding details before review.`)
          return
        }
      }
      setHeaderNotice(result.message)
    } finally {
      setImportBusy(false)
      event.target.value = ''
    }
  }

  function handleAiAssistGenerate() {
    const result = importFromAiAssist(aiPrompt)
    if (result.ok) {
      setTab('import_map')
      if (importStage === 'toc_seed' || importStage === 'confirmed') {
        setImportStage('detail_ingest')
        setHeaderNotice(`${result.message} Detail ingestion started; move to review when ready.`)
        return
      }
    }
    setHeaderNotice(result.message)
  }

  async function handleExternalAssistGenerate() {
    if (!aiPrompt.trim()) {
      setHeaderNotice('Paste text first, then run external assist.')
      return
    }
    if (externalAssistProvider === 'none') {
      setHeaderNotice('Select Gemini or Copilot external assist first.')
      return
    }
    if (externalAssistProvider === 'copilot') {
      const normalized = normalizeOcrText(aiPrompt)
      if (normalized) setAiPrompt(normalized)
      const result = importFromAiAssist(normalized || aiPrompt)
      if (result.ok) {
        setTab('import_map')
        if (importStage === 'toc_seed' || importStage === 'confirmed') {
          setImportStage('detail_ingest')
        }
      }
      setHeaderNotice(`Copilot assist path executed via local import flow. ${result.message}`)
      return
    }

    const model = geminiModel.trim()
    if (!model) {
      setHeaderNotice('Gemini model missing. Add a model like "gemini-2.5-flash".')
      return
    }

    setExternalAssistBusy(true)
    try {
      const normalized = normalizeOcrText(aiPrompt)
      const source = normalized || aiPrompt
      const selectedMode = geminiAssistMode === 'detail_steps' ? guessGeminiAssistMode(source) : geminiAssistMode
      const gemini = await callGeminiViaProxy({
        model,
        mode: selectedMode,
        source,
      })
      if (!gemini.ok) {
        setHeaderNotice(gemini.error)
        return
      }
      const transformed = gemini.text.trim()
      setAiPrompt(transformed)
      if (selectedMode === 'ocr_cleanup') {
        setHeaderNotice('Gemini OCR cleanup complete. Review text, then run import.')
        return
      }
      const importPayload =
        gemini.structured && gemini.structured.schemaVersion === 'import-model-v2'
          ? textFromStructuredGeminiPayload(gemini.structured)
          : transformed
      const result = selectedMode === 'toc_seed' ? importFromText(importPayload) : importFromAiAssist(importPayload)
      if (result.ok) {
        setTab('import_map')
        if (importStage === 'toc_seed' || importStage === 'confirmed') {
          setImportStage('detail_ingest')
        }
      }
      const warningSuffix =
        gemini.warnings.length > 0 ? ` Warnings: ${gemini.warnings.join(' ')}` : ''
      setHeaderNotice(`Gemini assist complete (${selectedMode}). ${result.message}${warningSuffix}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gemini assist failed.'
      setHeaderNotice(message)
    } finally {
      setExternalAssistBusy(false)
    }
  }

  function handleImportStageAction() {
    if (importStage === 'toc_seed') {
      setImportStage('detail_ingest')
      setTab('import_map')
      setHeaderNotice('Cluster seeding marked complete. Start importing detailed process text.')
      return
    }
    if (importStage === 'detail_ingest') {
      setImportStage('review')
      setTab('import_map')
      setHeaderNotice('Moved to review stage. Refine clusters, phases, and connections.')
      return
    }
    if (importStage === 'review') {
      setImportStage('confirmed')
      setTab('flow')
      setHeaderNotice('Import confirmed. Continue polishing in Journey Flow.')
      return
    }
    setImportStage('toc_seed')
    setTab('import_map')
    setHeaderNotice('Started new import cycle. Seed clusters from TOC first.')
  }

  function toggleImportMenu() {
    setImportMenuOpen((open) => {
      const next = !open
      if (next) setExportMenuOpen(false)
      return next
    })
  }

  function toggleExportMenu() {
    setExportMenuOpen((open) => {
      const next = !open
      if (next) setImportMenuOpen(false)
      return next
    })
  }

  function closeHeaderMenus() {
    setImportMenuOpen(false)
    setExportMenuOpen(false)
  }

  function handlePreviewClick(event: MouseEvent, featureName: string) {
    event.preventDefault()
    setHeaderNotice(`${featureName} is visible in preview style and not usable yet.`)
  }

  function onDragStop() {
    updateCurrentVersionLayoutFromRF(rfNodes.map((node) => ({ id: node.id, position: node.position })))
  }

  function selectedTabLabel() {
    if (selectedTab === 'import_map') return 'import map'
    if (selectedTab === 'map') return 'process map'
    if (selectedTab === 'flow') return 'journey flow'
    return selectedTab
  }

  const isMapProjectionTab = selectedTab === 'map' || selectedTab === 'import_map'
  const importMapClusterPrepEnabled =
    PREP_FEATURE_FLAGS.importMapClustersLayer && selectedTab === 'import_map'
  const mapPhasesCollapsedForImportMap = importMapClusterPrepEnabled && importMapPhasesCollapsed
  const mapPanelHeading = selectedTab === 'import_map' ? 'Import Map Projection' : 'Process Map Projection'
  const mapPanelHint =
    selectedTab === 'import_map'
      ? 'Chapter guide while refining imported content, then actor layers.'
      : 'Chapter guide across the full map, then actor layers.'
  const aiPromptLines = useMemo(
    () =>
      aiPrompt
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [aiPrompt],
  )
  const clusterLineCount = useMemo(
    () => aiPromptLines.filter((line) => /^cluster\s*:/i.test(line)).length,
    [aiPromptLines],
  )
  const tocSeedDetected = clusterLineCount >= 2 || (clusterLineCount === 1 && importStage === 'toc_seed')
  const aiImportHint = aiPromptLines.length === 0
    ? 'Awaiting input. Add "Cluster:" lines for TOC seeding or process text for detail import.'
    : tocSeedDetected
      ? 'Detected TOC seed mode. Cluster lines will seed import map buckets.'
      : 'Detected detail import mode. Text will generate candidate process steps.'
  const importStageIndex = IMPORT_STAGE_STEPS.findIndex((step) => step.id === importStage)
  const importStageActionLabel =
    importStage === 'toc_seed'
      ? 'Mark TOC seeded'
      : importStage === 'detail_ingest'
        ? 'Move to Review'
        : importStage === 'review'
          ? 'Confirm Import'
          : 'Start New Import'
  const aiSidebarExpanded = aiAssistExpanded && sidebarVisible
  const workspaceClasses = `workspace ${!sidebarVisible ? 'sidebar-hidden' : ''} ${!inspectorVisible ? 'inspector-hidden' : ''} ${aiSidebarExpanded ? 'ai-expanded-horizontal' : ''}`
  const documentMaps = useMemo(
    () =>
      selectedVersion
        ? getImportDocumentMapsForSelectedVersion() ?? {
            contentMap: null,
            importedMap: null,
          }
        : null,
    [selectedVersion, getImportDocumentMapsForSelectedVersion],
  )
  const activeContentMap = documentMaps?.contentMap ?? null
  const activeImportedMap = documentMaps?.importedMap ?? null
  function runGoldImportFixture(fixture: GoldImportFixture): {
    metrics: ImportEvalMetrics
    model: CanonicalModel
  } | null {
    const clearResult = clearCurrentVersion()
    if (!clearResult.ok) {
      setHeaderNotice(clearResult.message)
      return null
    }
    importFromText(fixture.tocInput)
    importFromAiAssist(fixture.chapterInput)
    const model = getCurrentModel()
    if (!model) {
      setHeaderNotice('Gold fixture run failed: no model returned.')
      return null
    }
    const metrics = evaluateImportQuality(fixture, model)
    return { metrics, model }
  }

  async function handleRunGoldImportSuite() {
    if (!selectedVersion || qaBusy) return
    setQaBusy(true)
    try {
      const summaries: string[] = []
      let aggregateScore = 0
      let aggregateCount = 0
      for (const fixture of GOLD_IMPORT_FIXTURES) {
        const result = runGoldImportFixture(fixture)
        if (!result) continue
        const { metrics } = result
        summaries.push(
          `${fixture.id}: clusterR ${metrics.clusterRecall.toFixed(2)} · stepR ${metrics.stepExtractionRecall.toFixed(2)} · assign ${metrics.assignmentAccuracy.toFixed(2)} · decisionF1 ${metrics.decisionF1.toFixed(2)} · unassigned ${metrics.unassignedRate.toFixed(2)} · explosion ${metrics.nodeExplosionRate.toFixed(2)}`,
        )
        aggregateScore +=
          metrics.clusterRecall +
          metrics.stepExtractionRecall +
          metrics.assignmentAccuracy +
          metrics.decisionF1
        aggregateCount += 4
      }
      const average = aggregateCount > 0 ? aggregateScore / aggregateCount : 0
      setHeaderNotice(
        summaries.length === 0
          ? 'Gold suite did not run. Select a version first.'
          : `Gold suite complete (${summaries.length} fixtures). Composite quality ${(average * 100).toFixed(1)}%. ${summaries[0]}`,
      )
    } finally {
      setQaBusy(false)
    }
  }

  function handleApplyGoldFixture(fixture: GoldImportFixture) {
    if (!selectedVersion || qaBusy) return
    setQaBusy(true)
    try {
      setAiPrompt(fixture.chapterInput)
      const result = runGoldImportFixture(fixture)
      if (!result) return
      const { metrics } = result
      setTab('import_map')
      setImportStage('review')
      setHeaderNotice(
        `${fixture.label} loaded. clusterR ${metrics.clusterRecall.toFixed(2)} · stepR ${metrics.stepExtractionRecall.toFixed(2)} · assign ${metrics.assignmentAccuracy.toFixed(2)} · decisionF1 ${metrics.decisionF1.toFixed(2)} · unassigned ${metrics.unassignedRate.toFixed(2)} · explosion ${metrics.nodeExplosionRate.toFixed(2)}.`,
      )
    } finally {
      setQaBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="logo">
          <div className="logo-mark">✦</div>
          flowcraft
        </div>
        <input
          className="flow-title"
          value={selectedArtifact?.name ?? 'Customer Support Journey'}
          readOnly
        />
        <div className="header-sep" />
        <div className="preview-wrap">
          <nav className="header-tabs" aria-label="Templates">
            {TEMPLATE_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                aria-disabled={!FEATURE_AVAILABILITY.templates}
                className={`htab ${activeTemplate === tab ? 'active' : ''} ${!FEATURE_AVAILABILITY.templates ? 'preview-feature' : ''}`}
                onClick={(event) => {
                  if (!FEATURE_AVAILABILITY.templates) {
                    handlePreviewClick(event, 'Template presets')
                    return
                  }
                  handleTemplateTabSelect(tab)
                }}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>
        <div className="header-right">
          <div className="menu-wrap">
            <button type="button" className="btn" onClick={toggleImportMenu} aria-expanded={importMenuOpen}>
              Import
            </button>
            {importMenuOpen && (
              <div className="menu-pop" onMouseLeave={closeHeaderMenus}>
                <div className="menu-head">Import options</div>
                <label className="menu-item">
                  Import JSON file
                  <input type="file" accept="application/json" onChange={handleImportJson} disabled={importBusy} />
                </label>
                <div className="menu-inline-control">
                  <label htmlFor="draftSourceType" className="menu-inline-label">
                    Draft source type
                  </label>
                  <select
                    id="draftSourceType"
                    className="menu-inline-select"
                    value={draftSourceType}
                    onChange={(event) => setDraftSourceType(event.target.value as DraftSourceType)}
                    disabled={importBusy}
                  >
                    <option value="text">Text notes</option>
                    <option value="document">Document extract</option>
                  </select>
                </div>
                <div className="menu-inline-control">
                  <label htmlFor="docMapTargetKind" className="menu-inline-label">
                    HTML map target
                  </label>
                  <select
                    id="docMapTargetKind"
                    className="menu-inline-select"
                    value={docMapTargetKind}
                    onChange={(event) =>
                      setDocMapTargetKind(event.target.value as ImportDocumentMapKind)
                    }
                    disabled={importBusy}
                  >
                    <option value="importedMap">Imported Map</option>
                    <option value="contentMap">Content Map</option>
                  </select>
                </div>
                <button type="button" className="menu-item" onClick={handleImportDraftBySelectedSource} disabled={importBusy}>
                  Import draft ({draftSourceType === 'document' ? 'Document extract' : 'Text notes'})
                </button>
                <label className="menu-item">
                  Import document file
                  <input
                    type="file"
                    accept=".txt,.md,.csv,.json,.doc,.docx,.pdf"
                    onChange={handleImportDocumentFile}
                    disabled={importBusy}
                  />
                </label>
              </div>
            )}
          </div>
          <button type="button" className="btn" onClick={handleValidateClick}>
            Validate
          </button>
          <div className="menu-wrap">
            <button type="button" className="btn primary" onClick={toggleExportMenu} aria-expanded={exportMenuOpen}>
              Export
            </button>
            {exportMenuOpen && (
              <div className="menu-pop" onMouseLeave={closeHeaderMenus}>
                <div className="menu-head">Export options</div>
                <button type="button" className="menu-item" onClick={handleExportJson} disabled={exportBusy}>
                  Export JSON
                </button>
                <button type="button" className="menu-item" onClick={handleExportMermaid} disabled={exportBusy}>
                  Export Mermaid
                </button>
                <button type="button" className="menu-item" onClick={handleExportSvg} disabled={exportBusy}>
                  Export SVG
                </button>
                <button type="button" className="menu-item" onClick={handleExportPng} disabled={exportBusy}>
                  Export PNG
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={workspaceClasses}>
        <aside className={`sidebar ${!sidebarVisible ? 'hidden' : ''} ${aiSidebarExpanded ? 'expanded' : ''}`}>
          <section className={`ai-panel ai-top ${!FEATURE_AVAILABILITY.aiAssist ? 'preview-section' : ''}`}>
            <div className="ai-panel-header">
              <div className="ai-badge">
                <span className="ai-badge-dot" />
                AI Assist
              </div>
              <button
                type="button"
                className={`tiny-btn ai-expand-btn ${aiAssistExpanded ? 'active' : ''}`}
                onClick={() => setAiAssistExpanded((current) => !current)}
                aria-pressed={aiAssistExpanded}
              >
                {aiAssistExpanded ? 'Collapse' : 'Expand'}
              </button>
              {!FEATURE_AVAILABILITY.aiAssist && <span className="preview-pill">Preview</span>}
            </div>
            <section className="import-stage-panel" aria-label="Import process stage">
              <div className="import-stage-head">
                <strong>Import process</strong>
                <span>{IMPORT_STAGE_STEPS[importStageIndex]?.label ?? 'Seed Clusters'}</span>
              </div>
              <ol className="import-stage-list">
                {IMPORT_STAGE_STEPS.map((step, index) => (
                  <li
                    key={step.id}
                    className={`import-stage-item ${index < importStageIndex ? 'done' : index === importStageIndex ? 'active' : 'pending'}`}
                  >
                    <span className="import-stage-dot" aria-hidden />
                    <span className="import-stage-copy">
                      <span className="import-stage-label">{step.label}</span>
                      <span className="import-stage-hint">{step.hint}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="tiny-btn import-stage-action"
                onClick={handleImportStageAction}
                disabled={!selectedVersion}
              >
                {importStageActionLabel}
              </button>
            </section>
            <div className="ai-prompt-wrap">
              <textarea
                className={`ai-prompt ${aiSidebarExpanded ? 'expanded' : ''} ${!FEATURE_AVAILABILITY.aiAssist ? 'preview-feature' : ''}`}
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                readOnly={!FEATURE_AVAILABILITY.aiAssist}
                placeholder={
                  FEATURE_AVAILABILITY.aiAssist ? AI_PLACEHOLDER : 'AI Assist preview'
                }
              />
              <button
                type="button"
                className={`ai-send ${!FEATURE_AVAILABILITY.aiAssist ? 'preview-feature' : ''}`}
                title="Generate flow"
                disabled={!FEATURE_AVAILABILITY.aiAssist}
                onClick={(event) => {
                  if (!FEATURE_AVAILABILITY.aiAssist) {
                    handlePreviewClick(event, 'AI Assist')
                    return
                  }
                  handleAiAssistGenerate()
                }}
              >
                →
              </button>
            </div>
            <div className="ai-assist-tools">
              <button
                type="button"
                className="tiny-btn ai-normalize-btn"
                onClick={handleNormalizeOcrText}
                disabled={!FEATURE_AVAILABILITY.aiAssist}
                title="Clean OCR line breaks, hyphenation, and spacing"
              >
                Normalize OCR
              </button>
              <select
                className="menu-inline-select ai-provider-select"
                value={externalAssistProvider}
                onChange={(event) => setExternalAssistProvider(event.target.value as ExternalAssistProvider)}
                disabled={!FEATURE_AVAILABILITY.aiAssist || externalAssistBusy}
                title="External AI provider"
              >
                <option value="none">External AI: off</option>
                <option value="gemini">External AI: Gemini</option>
                <option value="copilot">External AI: Copilot (manual)</option>
              </select>
              {externalAssistProvider === 'gemini' && (
                <>
                  <select
                    className="menu-inline-select ai-provider-select"
                    value={geminiAssistMode}
                    onChange={(event) => setGeminiAssistMode(event.target.value as GeminiAssistMode)}
                    disabled={!FEATURE_AVAILABILITY.aiAssist || externalAssistBusy}
                    title="Gemini conversion mode"
                  >
                    {GEMINI_ASSIST_MODE_OPTIONS.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="ai-provider-input ai-provider-model"
                    value={geminiModel}
                    onChange={(event) => setGeminiModel(event.target.value)}
                    placeholder="Gemini model"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!FEATURE_AVAILABILITY.aiAssist || externalAssistBusy}
                    title="Model sent through local server proxy"
                  />
                </>
              )}
              <button
                type="button"
                className="ai-provider-go"
                onClick={handleExternalAssistGenerate}
                disabled={!FEATURE_AVAILABILITY.aiAssist || externalAssistBusy}
                title="Run external AI assist"
              >
                {externalAssistBusy ? 'Running…' : 'Use External AI'}
              </button>
            </div>
            <div className="ai-import-hint">{aiImportHint}</div>
          </section>

          {!aiSidebarExpanded && (
            <>
          <section className="sb-sec build-sec">
            <div className="sb-row">
              <div className="sb-label">Build</div>
              <span className="section-note">Pinned</span>
            </div>
            <div className="sb-subhead">Node Types</div>
            {NODE_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`pal-card ${opt.value}`}
                draggable={Boolean(selectedVersion)}
                onDragStart={(event) => handlePaletteDragStart(event, opt.value)}
                onClick={() => handleAddNode(opt.value)}
                disabled={!selectedVersion}
              >
                <span className={`pal-shape shape-${opt.value}`} />
                <span className="pal-info">
                  <span className="pal-name">{opt.label}</span>
                  <span className="pal-desc">{opt.desc}</span>
                </span>
              </button>
            ))}

            <div className="sb-row">
              <div className="sb-subhead">Connection Type</div>
              <div className="mode-switch" role="tablist" aria-label="Connection mode">
                <button
                  type="button"
                  className={`mode-tag ${edgeMode === 'auto' ? 'active auto' : ''}`}
                  onClick={() => setEdgeMode('auto')}
                >
                  Auto
                </button>
                <button
                  type="button"
                  className={`mode-tag ${edgeMode === 'manual' ? 'active manual' : ''}`}
                  onClick={() => setEdgeMode('manual')}
                >
                  Manual
                </button>
              </div>
            </div>
            {edgeMode === 'manual' ? (
              <div className="ct-grid">
                {EDGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`ct-btn ${activeEdgeType === opt.value ? 'active' : ''}`}
                    data-ct={opt.value}
                    onClick={() => setActiveEdgeType(opt.value)}
                  >
                    <span className="ct-preview-wrap">
                      <EdgeTypePreview type={opt.value} />
                    </span>
                    <span className="ct-copy">
                      <span className="ct-label">{opt.label}</span>
                      <span className="ct-meta">
                        {opt.lineHint} • {opt.arrowHint}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="sb-sec collapsible">
            <button
              type="button"
              className="collapse-head"
              onClick={() => setStructureOpen((open) => !open)}
              aria-expanded={structureOpen}
            >
              <span className="sb-label">Structure</span>
              <span className="collapse-indicator">{structureOpen ? '−' : '+'}</span>
            </button>
            {structureOpen && (
              <div className="section-subcollapse">
                <button
                  type="button"
                  className="cluster-head"
                  onClick={() => openStructureCluster('projects')}
                  aria-expanded={isStructureClusterOpen('projects')}
                >
                  <span className="sb-subhead">Projects</span>
                  <span className="collapse-indicator">
                    {isStructureClusterOpen('projects') ? '−' : '+'}
                  </span>
                </button>
                {isStructureClusterOpen('projects') && (
                  <div className="cluster-content">
                    <div className="sb-row">
                      <div className="sb-subhead">Projects</div>
                      <button type="button" className="tiny-btn" onClick={handleCreateProject}>
                        + add
                      </button>
                    </div>
                    <div className="stack-list">
                      {projects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className={`stack-btn ${project.id === selectedProjectId ? 'active' : ''}`}
                          onClick={() => selectProject(project.id)}
                        >
                          {project.name}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="tiny-btn danger"
                      onClick={() => selectedProjectId && deleteProject(selectedProjectId)}
                      disabled={!selectedProjectId || projects.length <= 1}
                    >
                      Delete current
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="cluster-head"
                  onClick={() => openStructureCluster('artifacts')}
                  aria-expanded={isStructureClusterOpen('artifacts')}
                >
                  <span className="sb-subhead">Artifacts</span>
                  <span className="collapse-indicator">
                    {isStructureClusterOpen('artifacts') ? '−' : '+'}
                  </span>
                </button>
                {isStructureClusterOpen('artifacts') && (
                  <div className="cluster-content">
                    <div className="sb-row">
                      <div className="sb-subhead">Artifacts</div>
                      <button type="button" className="tiny-btn" onClick={handleCreateArtifact} disabled={!selectedProject}>
                        + add
                      </button>
                    </div>
                    <div className="stack-list">
                      {projectArtifacts.map((artifact) => (
                        <button
                          key={artifact.id}
                          type="button"
                          className={`stack-btn ${artifact.id === selectedArtifactId ? 'active' : ''}`}
                          onClick={() => selectArtifact(artifact.id)}
                        >
                          {artifact.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="cluster-head"
                  onClick={() => openStructureCluster('versions')}
                  aria-expanded={isStructureClusterOpen('versions')}
                >
                  <span className="sb-subhead">Versions</span>
                  <span className="collapse-indicator">
                    {isStructureClusterOpen('versions') ? '−' : '+'}
                  </span>
                </button>
                {isStructureClusterOpen('versions') && (
                  <div className="cluster-content">
                    <div className="sb-row">
                      <div className="sb-subhead">Versions</div>
                      <button type="button" className="tiny-btn" onClick={handleCreateVersion} disabled={!selectedArtifact}>
                        + add
                      </button>
                    </div>
                    <div className="stack-list">
                      {versions.map((version) => (
                        <button
                          key={version.id}
                          type="button"
                          className={`stack-btn ${version.id === selectedVersionId ? 'active' : ''}`}
                          onClick={() => selectVersion(version.id)}
                        >
                          {version.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="sb-sec collapsible">
            <button
              type="button"
              className="collapse-head"
              onClick={() => setPreviewOpen((open) => !open)}
              aria-expanded={previewOpen}
            >
              <span className="sb-label">Preview Features</span>
              <span className="collapse-indicator">{previewOpen ? '−' : '+'}</span>
            </button>
            {previewOpen && <div />}
          </section>
            </>
          )}
        </aside>

        <section className="canvas-panel">
          <div className="canvas-top">
            <div className="sample-template-strip" role="group" aria-label="Quick import templates">
              {QUICK_IMPORT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="sti-pill"
                  onClick={() => {
                    setActiveTemplate(template.tab)
                    applyQuickImportTemplate(template.lines, template.label, template.description)
                  }}
                  disabled={!selectedVersion}
                >
                  {template.label}
                </button>
              ))}
              {IMPORT_TEST_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`sti-pill ${template.id === 'gold-toc-seed' ? 'qa' : ''}`}
                  onClick={() => handleApplyImportTestTemplate(template)}
                  disabled={!selectedVersion}
                  title={
                    template.id === 'gold-toc-seed'
                      ? 'Seed Step 1 clusters from full gold TOC'
                      : 'Load extracted chapter text for import testing'
                  }
                >
                  {template.label}
                </button>
              ))}
              <button
                type="button"
                className="sti-pill clear"
                onClick={handleClearTemplate}
                disabled={!selectedVersion}
                title="Reset current version to blank"
              >
                Clear
              </button>
              {IMPORT_QA_PRESETS_ENABLED && (
                <>
                  {GOLD_IMPORT_FIXTURES.map((fixture) => (
                    <button
                      key={fixture.id}
                      type="button"
                      className="sti-pill qa"
                      onClick={() => handleApplyGoldFixture(fixture)}
                      disabled={!selectedVersion || qaBusy}
                      title={`Run ${fixture.label}`}
                    >
                      {fixture.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="sti-pill qa-suite"
                    onClick={handleRunGoldImportSuite}
                    disabled={!selectedVersion || qaBusy}
                    title="Run all gold import fixtures"
                  >
                    {qaBusy ? 'Running QA…' : 'Run Gold Suite'}
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              className={`tab-btn ${selectedTab === 'flow' ? 'active' : ''}`}
              onClick={() => setTab('flow')}
            >
              Journey Flow
            </button>
            <button
              type="button"
              className={`tab-btn ${selectedTab === 'map' ? 'active' : ''}`}
              onClick={() => setTab('map')}
            >
              Process Map
            </button>
            <button
              type="button"
              className={`tab-btn ${selectedTab === 'import_map' ? 'active' : ''}`}
              onClick={() => setTab('import_map')}
            >
              Import Map
              <span className="import-map-badge">for imports</span>
            </button>
            <button
              type="button"
              className="btn tiny"
              onClick={() => handleAddNode('process')}
              disabled={!selectedVersion}
            >
              + Process Node
            </button>
            <div className="sidebar-toggle-wrap canvas-toggle-wrap" role="group" aria-label="Sidebar visibility">
              <button
                type="button"
                className={`dock-btn ${sidebarVisible ? 'active' : ''}`}
                onClick={() => setSidebarVisible((current) => !current)}
                aria-pressed={sidebarVisible}
                title="Toggle sidebar"
              >
                Menu
              </button>
            </div>
            <div className="inspector-toggle-wrap" role="group" aria-label="Inspector visibility">
              <button
                type="button"
                className={`dock-btn ${inspectorVisible ? 'active' : ''}`}
                onClick={() => setInspectorVisible((current) => !current)}
                aria-pressed={inspectorVisible}
                title="Toggle inspector"
              >
                Inspector
              </button>
            </div>
            <span className="flow-hint">Tip: click/drag node types to add, then drag from handles to connect</span>
          </div>

          <div
            className={`canvas-wrap canvas-tool-${canvasTool}`}
            ref={canvasWrapRef}
            onDragOver={handleCanvasDragOver}
            onDrop={handleCanvasDrop}
          >
            {selectedTab === 'flow' && (
              <div className="flow-empty-hint">
                <strong>How to build</strong>
                <span>1) Add nodes from Build panel (click or drag/drop).</span>
                <span>2) Drag from one handle to another to connect.</span>
                <span>3) Select any node/edge to edit in Inspector.</span>
              </div>
            )}
            {selectedTab === 'flow' ? (
              selectedVersion ? (
                <ReactFlow
                  nodes={rfNodes}
                  edges={rfEdges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={handleConnect}
                  onNodeDragStop={onDragStop}
                  onNodeClick={(_, node) => {
                    if (!inspectorVisible) setInspectorVisible(true)
                    selectNode(node.id)
                  }}
                  onEdgeClick={(_, edge) => {
                    if (!inspectorVisible) setInspectorVisible(true)
                    selectEdge(edge.id)
                  }}
                  onPaneClick={() => {
                    selectNode(null)
                    selectEdge(null)
                  }}
                  onInit={setRfInstance}
                  nodeTypes={nodeTypes}
                  nodesDraggable
                  nodesConnectable={canvasTool === 'connect'}
                  elementsSelectable
                  fitView
                >
                  <Background gap={24} color="#e6eaf1" />
                  {!inspectorVisible && <MiniMap className="floating-minimap" position="bottom-right" />}
                  <Controls className="floating-controls" position="bottom-left" />
                </ReactFlow>
              ) : (
                <div className="canvas-empty">
                  <h3>No version selected</h3>
                  <p>Select or create an artifact/version to begin.</p>
                </div>
              )
            ) : isMapProjectionTab && selectedVersion ? (
              <div className="map-view">
                <div className="map-header">
                  <h3>{mapPanelHeading}</h3>
                  <p>{mapPanelHint}</p>
                </div>

                {importMapClusterPrepEnabled && (
                  <section className="map-cluster-guide">
                    <div className="map-phase-head">
                      <strong>Map Clusters</strong>
                      <span>Import-map-only cluster layer (prep mode)</span>
                    </div>
                    <div className="map-cluster-strip">
                      {mapClusters.length === 0 ? (
                        <div className="map-cluster-empty">
                          Seed clusters from TOC text to prepare import allocation.
                        </div>
                      ) : (
                        mapClusters.map((cluster) => (
                          <article key={cluster.id} className={`map-cluster-chip ${cluster.isEmpty ? 'is-empty' : ''}`}>
                            <h4>{cluster.name}</h4>
                            <p>{cluster.summary}</p>
                            <span className="count-pill">{cluster.count} mapped</span>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                )}

                <section className={`map-phase-guide ${mapPhasesCollapsedForImportMap ? 'collapsed' : ''}`}>
                  <div className="map-phase-head">
                    <strong>Map Phases</strong>
                    <div className="map-phase-head-actions">
                      <span>Chapter overview above customer layer</span>
                      {importMapClusterPrepEnabled && (
                        <button
                          type="button"
                          className="tiny-btn map-phase-toggle"
                          onClick={() => setImportMapPhasesCollapsed((collapsed) => !collapsed)}
                        >
                          {mapPhasesCollapsedForImportMap ? 'Show map phases' : 'Hide map phases'}
                        </button>
                      )}
                    </div>
                  </div>
                  {mapPhasesCollapsedForImportMap ? (
                    <div className="map-phase-collapsed-note">
                      Map Phases hidden in Import Map focus mode. Use "Show map phases" to restore.
                    </div>
                  ) : (
                    <div className="map-phase-strip">
                      {mapChapters.length === 0 ? (
                        <div className="map-phase-empty">Add nodes in Journey Flow to generate chapter phases.</div>
                      ) : (
                        mapChapters.map((chapter) => (
                          <article key={chapter.id} className="map-phase-chip">
                            <h4>{chapter.title}</h4>
                            <p>{chapter.summary}</p>
                            <span className="count-pill">{chapter.count} steps</span>
                          </article>
                        ))
                      )}
                    </div>
                  )}
                </section>

                {selectedTab === 'import_map' && (
                  <section className="docmap-stack">
                    <div className="docmap-stack-head">
                      <div className="docmap-stack-title-wrap">
                        <strong>Document map review</strong>
                        <span className="docmap-stack-subtitle">
                          Content Map and Imported Map panels available for side-by-side QA.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="tiny-btn docmap-panel-toggle"
                        onClick={() => setDocMapPanelsCollapsed((collapsed) => !collapsed)}
                      >
                        {docMapPanelsCollapsed ? 'Show document maps' : 'Hide document maps'}
                      </button>
                    </div>
                    {docMapPanelsCollapsed ? (
                      <div className="docmap-visible-note">
                        Document map panels are hidden. Use "Show document maps" to re-open Content Map and
                        Imported Map.
                      </div>
                    ) : (
                      <>
                        {renderDocumentMapPanel({
                          kind: 'contentMap',
                          map: activeContentMap,
                          filter: docMapContentFilter,
                          setFilter: setDocMapContentFilter,
                        })}
                        {renderDocumentMapPanel({
                          kind: 'importedMap',
                          map: activeImportedMap,
                          filter: docMapImportedFilter,
                          setFilter: setDocMapImportedFilter,
                        })}
                      </>
                    )}
                  </section>
                )}

                {mapActorBuckets.length === 0 ? (
                  <div className="canvas-empty">
                    <h3>No mapped lanes yet</h3>
                    <p>Add and assign actors in Journey Flow to populate the map layers.</p>
                  </div>
                ) : (
                  <div className="lane-list">
                    {mapActorBuckets.map((bucket) => (
                      <section key={bucket.actor} className="lane">
                        <div className="lane-title">{bucket.label}</div>
                        <div className="lane-items">
                          {bucket.items.map((node) => (
                            <article key={node.id} className={`lane-node ${node.type}`}>
                              <strong>{node.label}</strong>
                              <span>{node.type}</span>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="canvas-empty">
                <h3>No version selected</h3>
                <p>Select or create an artifact/version to view the Process Map.</p>
              </div>
            )}
            {selectedTab === 'flow' && selectedVersion && (
              <div className="canvas-context-toolbar" role="toolbar" aria-label="Canvas context actions">
                <button
                  type="button"
                  className={`ctx-btn ${canvasTool === 'select' ? 'active' : ''}`}
                  onClick={() => handleSetCanvasTool('select')}
                  title="Select mode (V)"
                  aria-pressed={canvasTool === 'select'}
                >
                  Select
                </button>
                <button
                  type="button"
                  className={`ctx-btn ${canvasTool === 'connect' ? 'active' : ''}`}
                  onClick={() => handleSetCanvasTool('connect')}
                  title="Connect mode (C)"
                  aria-pressed={canvasTool === 'connect'}
                >
                  Connect
                </button>
                <span className="ctx-sep" aria-hidden />
                <button
                  type="button"
                  className="ctx-btn"
                  onClick={handleCanvasToolbarUndo}
                  disabled={!canUndo}
                  title="Undo (Ctrl/Cmd+Z)"
                >
                  Undo
                </button>
                <button
                  type="button"
                  className="ctx-btn danger"
                  onClick={handleCanvasToolbarDelete}
                  disabled={!selectedNodeId && !selectedEdgeId}
                  title="Delete selected"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className={`inspector ${!inspectorVisible ? 'hidden' : ''}`}>
          <h2>Inspector</h2>
          {!selectedVersion ? (
            <div className="inspector-empty">
              <p className="muted">No version selected.</p>
              <p className="muted">Choose or create a version to edit nodes and edges.</p>
            </div>
          ) : selectedNode ? (
            <>
              <p className="muted">Selected node: {selectedNode.id}</p>
              <div className="field-group">
                <label htmlFor="nodeTitle">Title</label>
                <input
                  id="nodeTitle"
                  type="text"
                  value={selectedNode.label}
                  onChange={(event) => updateNodeLabel(selectedNode.id, event.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="nodeNotes">Notes</label>
                <textarea
                  id="nodeNotes"
                  rows={5}
                  value={selectedNode.metadata.notes ?? ''}
                  onChange={(event) => updateNodeNotes(selectedNode.id, event.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="nodeActor">Actor</label>
                <select
                  id="nodeActor"
                  value={selectedNode.actor}
                  onChange={(event) => updateNodeActor(selectedNode.id, event.target.value as Actor)}
                >
                  {ACTOR_OPTIONS.map((opt) => (
                    <option key={opt.value || 'unassigned'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="reviewState">Review State</label>
                <select
                  id="reviewState"
                  value={selectedVersion.reviewState}
                  onChange={(event) =>
                    setVersionReviewState(selectedVersion.id, event.target.value as ReviewState)
                  }
                >
                  {reviewOptions().map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Validation</label>
                <div className="val-list">
                  {validation.length === 0 ? (
                    <div className="val-row ok">No validation issues</div>
                  ) : (
                    validation.slice(0, 6).map((issue) => (
                      <div
                        key={`${issue.code}-${issue.targetId ?? 'global'}-${issue.message}`}
                        className={`val-row ${issue.severity === 'error' ? 'error' : issue.severity === 'warn' ? 'warn' : 'ok'}`}
                      >
                        [{issue.code}] {issue.message}
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="field-group">
                <label>Review audit trail</label>
                <div className="val-list">
                  {reviewAuditTrail.length === 0 ? (
                    <div className="val-row ok">No review audit entries yet</div>
                  ) : (
                    reviewAuditTrail.map((line) => (
                      <div key={line} className="val-row ok">
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="field-group">
                <label>Export history</label>
                <div className="val-list">
                  {exportHistory.length === 0 ? (
                    <div className="val-row ok">No exports recorded yet</div>
                  ) : (
                    exportHistory.map((item) => (
                      <div key={item.id} className="val-row ok">
                        {item.format.toUpperCase()} - {item.fileName} ({item.sizeBytes} bytes)
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="inspector-actions">
                <button
                  type="button"
                  className="btn danger full"
                  onClick={handleDeleteSelection}
                  disabled={!selectedNodeId && !selectedEdgeId}
                >
                  Delete selected
                </button>
                <button type="button" className="btn full" onClick={undoCurrentVersion} disabled={!canUndo}>
                  Undo
                </button>
              </div>
            </>
          ) : selectedEdge ? (
            <>
              <p className="muted">Selected edge: {selectedEdge.id}</p>
              <p className="muted">
                {selectedEdge.from} -&gt; {selectedEdge.to}
              </p>
              <div className="field-group">
                <label htmlFor="edgeType">Edge Type</label>
                <select
                  id="edgeType"
                  value={selectedEdge.type}
                  onChange={(event) => updateEdgeType(selectedEdge.id, event.target.value as EdgeType)}
                >
                  {EDGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="edgeLabel">Edge label</label>
                <input
                  id="edgeLabel"
                  type="text"
                  value={selectedEdge.label ?? ''}
                  onChange={(event) => updateEdgeLabel(selectedEdge.id, event.target.value)}
                />
              </div>
              <div className="inspector-actions">
                <button
                  type="button"
                  className="btn danger full"
                  onClick={handleDeleteSelection}
                  disabled={!selectedNodeId && !selectedEdgeId}
                >
                  Delete selected
                </button>
                <button type="button" className="btn full" onClick={undoCurrentVersion} disabled={!canUndo}>
                  Undo
                </button>
              </div>
            </>
          ) : (
            <div className="inspector-empty">
              <p className="muted">Contextual inspector</p>
              <p className="muted">Select a node or connection on canvas to edit properties.</p>
            </div>
          )}
        </aside>
      </main>

      <footer className="statusbar">
        <span className="sb-val">{currentModel?.nodes.length ?? 0} nodes</span>
        <span className="sb-sep">|</span>
        <span>{currentModel?.edges.length ?? 0} connections</span>
        <span className="sb-sep">|</span>
        <span>{selectedTabLabel()}</span>
        <span className="sb-sep">|</span>
        <span className="legend-item">
          <span className="legend-dot live" />
          Live
        </span>
        <span className="legend-item">
          <span className="legend-dot preview" />
          Preview
        </span>
        <span className="sb-hint">{headerNotice || 'Drag nodes to canvas - connect with handles - edit in right panel'}</span>
      </footer>
    </div>
  )
}
