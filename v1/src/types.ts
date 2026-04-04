export type SchemaVersion = '1.1'

export type ReviewState = 'draft' | 'in_review' | 'approved' | 'rejected'
export type ViewTab = 'flow' | 'import_map' | 'map'
export type ImportMode = 'manual' | 'text' | 'doc' | 'ai'

export type Actor = '' | 'customer' | 'agent' | 'system' | 'manager' | 'external'
export type Origin = 'manual' | 'text_import' | 'doc_import' | 'ai_assist'
export type FlowNodeType = 'terminal' | 'process' | 'decision' | 'data' | 'annotation'
export type EdgeType = 'sequential' | 'conditional' | 'parallel' | 'fallback'

export type XY = { x: number; y: number }

export type Workspace = {
  id: string
  name: string
  createdAt: string
}

export type Folder = {
  id: string
  workspaceId: string
  name: string
}

export type Project = {
  id: string
  workspaceId: string
  folderId: string | null
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export type SourceDocRef = {
  docId: string
  name: string
  type: 'pdf' | 'docx' | 'pptx' | 'txt' | 'email' | 'csv' | 'bpmn'
  version?: string
}

export type EvidenceRef = {
  docId: string
  chunkId: string
  quote?: string
  page?: number
  section?: string
}

export type FlowNode = {
  id: string
  type: FlowNodeType
  label: string
  actor: Actor
  status: 'live' | 'planned' | 'deprecated'
  metadata: {
    system?: string
    sla?: string
    aht?: string
    volume?: string
    notes?: string
    stage?: string
    touchpoint?: string
    emotion?: number
  }
  evidence?: EvidenceRef[]
  confidence?: number
  origin: Origin
  position: XY
}

export type EdgeModel = {
  id: string
  from: string
  to: string
  type: EdgeType
  label?: string
  evidence?: EvidenceRef[]
  confidence?: number
  origin: Origin
}

export type FlowEdge = EdgeModel

export type ViewLayout = {
  nodePositions: Record<string, XY>
  groups?: Array<{ id: string; label: string; nodeIds: string[] }>
}

export type ConfidenceSummary = {
  overall: number
  extraction: number
  synthesis: number
  validationPenalty: number
}

export type ValidationResult = {
  code:
    | 'NO_TERMINAL'
    | 'DECISION_NEEDS_EXITS'
    | 'ISOLATED_NODE'
    | 'UNLABELED_CONDITIONAL'
    | 'CYCLE_WARNING'
    | 'MISSING_EVIDENCE_AI_ELEMENT'
  severity: 'info' | 'warn' | 'error'
  message: string
  targetId?: string
}

export type ReviewAuditEvent = 'state_transition' | 'policy_block'

export type ReviewAuditEntry = {
  id: string
  at: string
  by: string
  event: ReviewAuditEvent
  from: ReviewState
  to: ReviewState
  note?: string
}

export type CanonicalModel = {
  id: string
  title: string
  sourceDocs: SourceDocRef[]
  nodes: FlowNode[]
  edges: EdgeModel[]
  confidence: ConfidenceSummary
  validation: ValidationResult[]
  projections: {
    flow: ViewLayout
    map: ViewLayout
  }
}

export type MapVersion = {
  id: string
  artifactId: string
  name: string
  schemaVersion: SchemaVersion
  data: CanonicalModel
  reviewState: ReviewState
  reviewAudit: ReviewAuditEntry[]
  exportArtifacts: ExportArtifact[]
  createdBy: string
  createdAt: string
}

export type ExportFormat = 'json' | 'mermaid' | 'svg' | 'png'

export type ExportArtifact = {
  id: string
  artifactId: string
  versionId: string
  format: ExportFormat
  fileName: string
  mimeType: string
  sizeBytes: number
  checksum: string
  createdAt: string
}

export type MapArtifact = {
  id: string
  projectId: string
  name: string
  currentVersionId: string
  currentApprovedVersionId: string | null
  createdAt: string
  updatedAt: string
  versions: MapVersion[]
}

export type AppState = {
  workspace: Workspace
  folders: Folder[]
  projects: Project[]
  artifacts: MapArtifact[]

  selectedProjectId: string | null
  selectedArtifactId: string | null
  selectedVersionId: string | null
  selectedTab: ViewTab

  selectedNodeId: string | null
  selectedEdgeId: string | null

  history: CanonicalModel[]
  historyIndex: number
}

export type PMStore = AppState & {
  createProject: (name: string) => void
  deleteProject: (projectId: string) => void
  selectProject: (projectId: string) => void
  createArtifact: (projectId: string, name: string) => void
  selectArtifact: (artifactId: string) => void
  createVersion: (artifactId: string, name: string) => void
  selectVersion: (versionId: string) => void
  setTab: (tab: ViewTab) => void

  updateNodeLabel: (nodeId: string, label: string) => void
  updateNodeNotes: (nodeId: string, notes: string) => void
  updateNodeActor: (nodeId: string, actor: Actor) => void
  setVersionReviewState: (versionId: string, reviewState: string) => void
  requestReviewTransition: (versionId: string, nextState: ReviewState, note?: string) => {
    ok: boolean
    message: string
  }
  importFromText: (input: string) => { ok: boolean; message: string }
  importFromDocument: (input: string) => { ok: boolean; message: string }
  importFromAiAssist: (prompt: string) => { ok: boolean; message: string }
  clearCurrentVersion: () => { ok: boolean; message: string }
  importFromJson: (rawJson: string) => { ok: boolean; message: string }
  recordExportForSelectedVersion: (payload: {
    format: ExportFormat
    fileName: string
    mimeType: string
    sizeBytes: number
    checksum: string
  }) => void
  getExportHistoryForSelectedVersion: () => ExportArtifact[]
  runValidation: () => { errors: number; warns: number }
  runValidationForCurrentVersion: () => ValidationResult[]
  canTransitionToReviewState: (
    versionId: string,
    nextState: ReviewState,
  ) => { allowed: boolean; reason: string }
  getReviewAuditTrail: () => string[]
  addNodeToCurrentVersion: (node: FlowNode) => void
  removeNodeFromCurrentVersion: (nodeId: string) => void
  addEdgeToCurrentVersion: (edge: FlowEdge) => void
  removeEdgeFromCurrentVersion: (edgeId: string) => void
  updateEdgeType: (edgeId: string, type: EdgeType) => void
  updateEdgeLabel: (edgeId: string, label: string) => void
  updateCurrentVersionLayoutFromRF: (positions: Array<{ id: string; position: XY }>) => void
  selectNode: (nodeId: string | null) => void
  selectEdge: (edgeId: string | null) => void
  undoCurrentVersion: () => void
  getSelectedVersion: () => MapVersion | undefined
  getCurrentModel: () => CanonicalModel | undefined
  getValidation: () => ValidationResult[]
}
