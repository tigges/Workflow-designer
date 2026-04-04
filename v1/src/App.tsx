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
import type {
  Actor,
  EdgeType,
  FlowEdge,
  FlowNode,
  ReviewState,
} from './types'

type RFNodeData = {
  label: string
  actor: Actor
  kind: FlowNode['type']
  status: FlowNode['status']
  terminalRole: 'start' | 'end' | null
}

const TEMPLATE_TABS = ['Support', 'Onboarding', 'Sales', 'Blank'] as const

const AI_CHIPS = ['Refund', 'Auth', 'Fulfillment', 'HR', 'Escalation', 'Approval']

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

const EDGE_OPTIONS: Array<{ value: EdgeType; label: string }> = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'conditional', label: 'Conditional' },
  { value: 'parallel', label: 'Parallel' },
  { value: 'fallback', label: 'Fallback' },
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
  templates: false,
  aiAssist: true,
  importJson: true,
} as const

type EdgeMode = 'auto' | 'manual'
type StructureCluster = 'projects' | 'artifacts' | 'versions' | null
type DraftSourceType = 'text' | 'document'

const UI_STORAGE_KEYS = {
  structureOpen: 'flowcraft.ui.structureOpen',
  previewOpen: 'flowcraft.ui.previewOpen',
  structureCluster: 'flowcraft.ui.structureCluster',
  edgeMode: 'flowcraft.ui.edgeMode',
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

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function terminalRole(node: FlowNode): 'start' | 'end' | null {
  if (node.type !== 'terminal') return null
  const label = node.label.trim().toLowerCase()
  if (label.startsWith('start')) return 'start'
  if (label.startsWith('end') || label.startsWith('close') || label.startsWith('closed')) return 'end'
  return null
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

function FlowNodeView({ data }: NodeProps<Node<RFNodeData>>) {
  return (
    <div
      className={`fnode-card kind-${data.kind} ${data.terminalRole ? `terminal-${data.terminalRole}` : ''}`}
    >
      <div className={`fnode-status-dot status-${data.status}`} />
      <div className="fnode-label">{data.label}</div>
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
  return {
    id: node.id,
    position: node.position,
    type: 'workflowNode',
    data: {
      label: node.label,
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
    updateNodeActor,
    updateEdgeLabel,
    updateEdgeType,
    setVersionReviewState,
    runValidation,
    importFromText,
    importFromDocument,
    importFromAiAssist,
    importFromJson,
    requestReviewTransition,
    canTransitionToReviewState,
    getReviewAuditTrail,
    addNodeToCurrentVersion,
    addEdgeToCurrentVersion,
    removeNodeFromCurrentVersion,
    removeEdgeFromCurrentVersion,
    updateCurrentVersionLayoutFromRF,
    selectNode,
    selectEdge,
    undoCurrentVersion,
  } = usePMStore()

  const [activeTemplate, setActiveTemplate] = useState<(typeof TEMPLATE_TABS)[number]>('Support')
  const [activeEdgeType, setActiveEdgeType] = useState<EdgeType>('sequential')
  const [edgeMode, setEdgeMode] = useState<EdgeMode>(() => readStoredEdgeMode())
  const [importTextDraft, setImportTextDraft] = useState('')
  const [draftSourceType, setDraftSourceType] = useState<DraftSourceType>('text')
  const [importBusy, setImportBusy] = useState(false)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [headerNotice, setHeaderNotice] = useState('')
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
    if (selectedTab !== 'flow') setTab('flow')
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
    if (!selectedVersion || selectedTab !== 'flow') return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleCanvasDrop(event: DragEvent<HTMLDivElement>) {
    if (!selectedVersion || selectedTab !== 'flow' || !rfInstance || !currentModel) return
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

  function handleExportJson() {
    if (!currentModel) {
      setHeaderNotice('Nothing to export yet. Create or select a version first.')
      return
    }
    downloadFile('flowcraft-export.json', JSON.stringify(currentModel, null, 2), 'application/json')
    setHeaderNotice('Exported JSON successfully.')
  }

  function handleExportSvg() {
    if (!currentModel) {
      setHeaderNotice('Nothing to export yet. Create or select a version first.')
      return
    }
    const width = 1400
    const height = 900
    const nodeById = new Map(currentModel.nodes.map((node) => [node.id, node]))
    const edgeElements = currentModel.edges
      .map((edge) => {
        const source = nodeById.get(edge.from)
        const target = nodeById.get(edge.to)
        if (!source || !target) return ''
        return `<line x1="${source.position.x + 70}" y1="${source.position.y + 28}" x2="${target.position.x + 70}" y2="${target.position.y + 28}" stroke="${edgeStroke(edge.type)}" stroke-width="1.7" />`
      })
      .join('')
    const nodeElements = currentModel.nodes
      .map((node) => {
        const x = node.position.x
        const y = node.position.y
        return `
        <rect x="${x}" y="${y}" rx="8" ry="8" width="140" height="56" fill="#ffffff" stroke="#d7dce5" />
        <text x="${x + 10}" y="${y + 24}" fill="#1a1d23" font-family="DM Sans, Arial, sans-serif" font-size="12">${escapeXml(node.label)}</text>
        <text x="${x + 10}" y="${y + 42}" fill="#647189" font-family="DM Sans, Arial, sans-serif" font-size="10">${escapeXml(actorLabel(node.actor))}</text>
      `
      })
      .join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#f8f9fb"/>
      ${edgeElements}
      ${nodeElements}
    </svg>`
    downloadFile('flowcraft-export.svg', svg, 'image/svg+xml')
    setHeaderNotice('Exported SVG snapshot successfully.')
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
    const result = importFromText(importTextDraft)
    setHeaderNotice(result.message)
    if (result.ok) setImportTextDraft('')
  }

  function handleImportDraftBySelectedSource() {
    if (draftSourceType === 'document') {
      handleImportDocumentFromDraft()
      return
    }
    handleImportText()
  }

  function handleImportDocumentFromDraft() {
    const result = importFromDocument(importTextDraft)
    setHeaderNotice(result.message)
  }

  async function handleImportDocumentFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setImportBusy(true)
    try {
      const content = await file.text()
      const payload = content.trim() || `Document: ${file.name}`
      const result = importFromDocument(payload)
      setHeaderNotice(result.message)
    } finally {
      setImportBusy(false)
      event.target.value = ''
    }
  }

  function handleAiAssistGenerate() {
    const result = importFromAiAssist(aiPrompt)
    setHeaderNotice(result.message)
  }

  function handleSendToReview() {
    if (!selectedVersion) {
      setHeaderNotice('Select a version to review.')
      return
    }
    const result = requestReviewTransition(selectedVersion.id, 'in_review', 'Submitted for review from sidebar')
    setHeaderNotice(result.message)
  }

  function handleAutoGate() {
    if (!selectedVersion) {
      setHeaderNotice('Select a version to auto-gate.')
      return
    }
    const suggested = canTransitionToReviewState(selectedVersion.id, 'approved')
    const target = suggested.allowed ? 'approved' : 'in_review'
    const result = requestReviewTransition(
      selectedVersion.id,
      target,
      suggested.allowed ? 'Auto-approved by policy gate' : `Auto-routed to review: ${suggested.reason}`,
    )
    setHeaderNotice(result.message)
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
                  setActiveTemplate(tab)
                }}
              >
                {tab}
              </button>
            ))}
          </nav>
          {!FEATURE_AVAILABILITY.templates && <span className="preview-pill">Preview</span>}
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
                <button type="button" className="menu-item" onClick={handleExportJson}>
                  Export JSON
                </button>
                <button type="button" className="menu-item" onClick={handleExportSvg}>
                  Export SVG
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <section className="sb-sec build-sec">
            <div className="sb-row">
              <div className="sb-label">Build</div>
              <span className="section-note">Pinned</span>
            </div>
            <div className="build-hint">
              Add node types first, then pick connection type and draw links on canvas.
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
            <div className="ct-grid">
              {EDGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`ct-btn ${activeEdgeType === opt.value ? 'active' : ''}`}
                  data-ct={opt.value}
                  onClick={() => setActiveEdgeType(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="mode-note">
              {edgeMode === 'auto'
                ? 'Auto picks connection type from node context.'
                : 'Manual uses the selected connection type exactly.'}
            </div>
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
            {!structureOpen && (
              <div className="collapsed-note">Collapsed. Expand to access projects, artifacts, and versions.</div>
            )}
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
            {!previewOpen && <div className="collapsed-note">Collapsed by default to keep build tools focused.</div>}
            {previewOpen && (
              <section className={`ai-panel ${!FEATURE_AVAILABILITY.aiAssist ? 'preview-section' : ''}`}>
                <div className="ai-panel-header">
                  <div className="ai-badge">
                    <span className="ai-badge-dot" />
                    AI Assist
                  </div>
                  {!FEATURE_AVAILABILITY.aiAssist && <span className="preview-pill">Preview</span>}
                </div>
                <div className="ai-chips">
                  {AI_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className={`ai-chip ${!FEATURE_AVAILABILITY.aiAssist ? 'preview-feature' : ''}`}
                      onClick={(event) => {
                        if (!FEATURE_AVAILABILITY.aiAssist) {
                          handlePreviewClick(event, 'AI Assist')
                          return
                        }
                        setAiPrompt(`Draft a ${chip.toLowerCase()} workflow`)
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <div className="sb-subhead">Prompt</div>
                <div className="ai-prompt-wrap">
                  <textarea
                    className={`ai-prompt ${!FEATURE_AVAILABILITY.aiAssist ? 'preview-feature' : ''}`}
                    value={aiPrompt}
                    onChange={(event) => setAiPrompt(event.target.value)}
                    readOnly={!FEATURE_AVAILABILITY.aiAssist}
                    placeholder={
                      FEATURE_AVAILABILITY.aiAssist
                        ? 'Describe a process to map'
                        : 'AI Assist preview - generation will be enabled in a later phase'
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
                <div className="ai-status">
                  {FEATURE_AVAILABILITY.aiAssist
                    ? 'Local fallback enabled.'
                    : 'Preview only - AI generation is not wired yet.'}
                </div>
                <div className="ct-grid">
                  <button type="button" className="ct-btn" onClick={handleSendToReview}>
                    Send Current Version to Review
                  </button>
                  <button type="button" className="ct-btn" onClick={handleAutoGate}>
                    Auto Gate by Policy
                  </button>
                </div>
              </section>
            )}
          </section>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-top">
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
              Journey Map
            </button>
            <button
              type="button"
              className="btn tiny"
              onClick={() => handleAddNode('process')}
              disabled={!selectedVersion}
            >
              + Process Node
            </button>
            <span className="flow-hint">Tip: click/drag node types to add, then drag from handles to connect</span>
          </div>

          <div
            className="canvas-wrap"
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
                  onNodeClick={(_, node) => selectNode(node.id)}
                  onEdgeClick={(_, edge) => selectEdge(edge.id)}
                  onPaneClick={() => {
                    selectNode(null)
                    selectEdge(null)
                  }}
                  onInit={setRfInstance}
                  nodeTypes={nodeTypes}
                  nodesDraggable
                  nodesConnectable
                  elementsSelectable
                  fitView
                >
                  <Background gap={24} color="#e6eaf1" />
                  <MiniMap />
                  <Controls />
                </ReactFlow>
              ) : (
                <div className="canvas-empty">
                  <h3>No version selected</h3>
                  <p>Select or create an artifact/version to begin.</p>
                </div>
              )
            ) : selectedVersion ? (
              <div className="map-view">
                <div className="map-header">
                  <h3>Journey Map Projection</h3>
                  <p>Chapter guide across the full map, then actor layers.</p>
                </div>

                <section className="map-phase-guide">
                  <div className="map-phase-head">
                    <strong>Map Phases</strong>
                    <span>Chapter overview above customer layer</span>
                  </div>
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
                </section>

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
                <p>Select or create an artifact/version to view the Journey Map.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="inspector">
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
                <label htmlFor="nodeLabel">Label</label>
                <input
                  id="nodeLabel"
                  type="text"
                  value={selectedNode.label}
                  onChange={(event) => updateNodeLabel(selectedNode.id, event.target.value)}
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
        <span>{selectedTab}</span>
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
