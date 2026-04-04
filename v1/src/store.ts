import { create } from 'zustand'
import { seedState } from './data/defaultData'
import type {
  AppState,
  CanonicalModel,
  EdgeType,
  FlowEdge,
  FlowNode,
  PMStore,
  ReviewState,
  ViewTab,
} from './types'

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
    return JSON.parse(raw) as AppState
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

function normalizeReviewState(state: string): ReviewState {
  if (state === 'draft' || state === 'in_review' || state === 'approved' || state === 'rejected') return state
  return 'draft'
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

  updateNodeActor: (nodeId, actor) => {
    set((state) => {
      const next = updateCurrentVersion(state, (model) => {
        model.nodes = model.nodes.map((n) => (n.id === nodeId ? { ...n, actor } : n))
      })
      persist(next)
      return next
    })
  },

  setVersionReviewState: (reviewState) => {
    set((state) => {
      const next = clone(state)
      const ref = getCurrentVersionRef(next)
      if (!ref) return state
      ref.version.reviewState = normalizeReviewState(reviewState)
      if (ref.version.reviewState === 'approved') {
        ref.artifact.currentApprovedVersionId = ref.version.id
      }
      ref.artifact.updatedAt = now()
      persist(next)
      return next
    })
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

export function buildDefaultNode(index: number): FlowNode {
  return {
    id: mkId('n'),
    type: 'process',
    label: 'New Step',
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
