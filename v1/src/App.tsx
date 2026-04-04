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
  EdgeType,
  ExportFormat,
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

type EdgeMode = 'auto' | 'manual'
type CanvasTool = 'select' | 'connect'
type StructureCluster = 'projects' | 'artifacts' | 'versions' | null
type DraftSourceType = 'text' | 'document'
type ImportStage = 'toc_seed' | 'detail_ingest' | 'review' | 'confirmed'

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

function isFlowCanvasTab(tab: 'flow' | 'import_map' | 'map') {
  return tab === 'flow'
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
    updateNodeActor,
    updateEdgeLabel,
    updateEdgeType,
    setVersionReviewState,
    runValidation,
    importFromText,
    importFromDocument,
    importFromAiAssist,
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
  } = usePMStore()

  const [activeTemplate, setActiveTemplate] = useState<(typeof TEMPLATE_TABS)[number]>('Support')
  const [activeEdgeType, setActiveEdgeType] = useState<EdgeType>('sequential')
  const [edgeMode, setEdgeMode] = useState<EdgeMode>(() => readStoredEdgeMode())
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('select')
  const [draftSourceType, setDraftSourceType] = useState<DraftSourceType>('text')
  const [importBusy, setImportBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [headerNotice, setHeaderNotice] = useState('')
  const [importStage, setImportStage] = useState<ImportStage>('toc_seed')
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

  async function handleImportDocumentFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setImportBusy(true)
    try {
      const content = await file.text()
      const payload = content.trim() || `Document: ${file.name}`
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
  const mapPanelHeading = selectedTab === 'import_map' ? 'Import Map Projection' : 'Process Map Projection'
  const mapPanelHint =
    selectedTab === 'import_map'
      ? 'Chapter guide while refining imported content, then actor layers.'
      : 'Chapter guide across the full map, then actor layers.'
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
