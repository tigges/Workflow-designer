import { useEffect, useMemo } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { buildDefaultEdge, buildDefaultNode, edgeStroke, usePMStore } from './store'
import type { Actor, EdgeType, FlowEdge, FlowNode, MapArtifact, MapVersion, ReviewState } from './types'

type RFNodeData = { label: string; actor: string; kind: FlowNode['type'] }

function toRFNode(node: FlowNode): Node<RFNodeData> {
  const colorByType: Record<FlowNode['type'], string> = {
    terminal: '#0f9e6e',
    process: '#2d6ef5',
    decision: '#8b45d4',
    data: '#d4720f',
    annotation: '#8a94a6',
  }
  const color = colorByType[node.type]
  return {
    id: node.id,
    position: node.position,
    data: {
      label: node.label,
      actor: node.actor || 'unassigned',
      kind: node.type,
    },
    style: {
      border: `1.4px solid ${color}66`,
      borderLeft: node.type === 'process' ? `3px solid ${color}` : undefined,
      borderRadius: node.type === 'terminal' ? 999 : 8,
      fontSize: 12,
      background: '#ffffff',
      minWidth: 130,
      padding: '8px 10px',
      color: '#1a1d23',
    },
  }
}

function toRFEdge(edge: FlowEdge): Edge {
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    animated: edge.type === 'parallel',
    style: {
      stroke: edgeStroke(edge.type),
      strokeDasharray: edge.type === 'fallback' ? '5 3' : undefined,
    },
  }
}

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

function reviewOptions(): ReviewState[] {
  return ['draft', 'in_review', 'approved', 'rejected']
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
    addNodeToCurrentVersion,
    addEdgeToCurrentVersion,
    removeNodeFromCurrentVersion,
    removeEdgeFromCurrentVersion,
    updateCurrentVersionLayoutFromRF,
    selectNode,
    selectEdge,
    undoCurrentVersion,
  } = usePMStore()

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

  const rfNodeSeed = useMemo(() => (currentModel ? currentModel.nodes.map(toRFNode) : []), [currentModel])
  const rfEdgeSeed = useMemo(() => (currentModel ? currentModel.edges.map(toRFEdge) : []), [currentModel])
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(rfNodeSeed)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(rfEdgeSeed)

  useEffect(() => {
    setRfNodes(rfNodeSeed)
    setRfEdges(rfEdgeSeed)
  }, [rfNodeSeed, rfEdgeSeed, setRfNodes, setRfEdges])

  const canUndo = history.length > 1 && historyIndex > 0

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

  function handleAddNode() {
    if (!currentModel) return
    addNodeToCurrentVersion(buildDefaultNode(currentModel.nodes.length))
  }

  function handleConnect(conn: Connection) {
    if (!conn.source || !conn.target) return
    addEdgeToCurrentVersion(buildDefaultEdge(conn.source, conn.target))
  }

  function handleDeleteSelection() {
    if (selectedNodeId) {
      removeNodeFromCurrentVersion(selectedNodeId)
      return
    }
    if (selectedEdgeId) removeEdgeFromCurrentVersion(selectedEdgeId)
  }

  function onDragStop() {
    updateCurrentVersionLayoutFromRF(rfNodes.map((n) => ({ id: n.id, position: n.position })))
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          ProcessMap V1
        </div>
        <div className="top-actions">
          <button type="button" className="btn ghost" onClick={undoCurrentVersion} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" className="btn" onClick={handleDeleteSelection} disabled={!selectedNodeId && !selectedEdgeId}>
            Delete Selected
          </button>
          <button type="button" className="btn primary" onClick={handleCreateProject}>
            New Project
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel left-panel">
          <h2>Projects</h2>
          <div className="project-list">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`project-item ${project.id === selectedProjectId ? 'active' : ''}`}
                onClick={() => selectProject(project.id)}
              >
                {project.name}
              </button>
            ))}
          </div>
          <div className="left-panel-inline-actions">
            <button
              type="button"
              className="tiny-btn danger"
              onClick={() => {
                if (selectedProjectId) deleteProject(selectedProjectId)
              }}
              disabled={!selectedProjectId || projects.length <= 1}
            >
              Delete Current
            </button>
          </div>

          <div className="group">
            <div className="group-head">
              <h3>Artifacts</h3>
              <button type="button" className="tiny-btn" onClick={handleCreateArtifact} disabled={!selectedProject}>
                + add
              </button>
            </div>
            <div className="list">
              {projectArtifacts.map((artifact: MapArtifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  className={`list-item ${artifact.id === selectedArtifactId ? 'active' : ''}`}
                  onClick={() => selectArtifact(artifact.id)}
                >
                  {artifact.name}
                </button>
              ))}
            </div>
          </div>

          <div className="group">
            <div className="group-head">
              <h3>Versions</h3>
              <button type="button" className="tiny-btn" onClick={handleCreateVersion} disabled={!selectedArtifact}>
                + add
              </button>
            </div>
            <div className="list">
              {versions.map((version: MapVersion) => (
                <button
                  key={version.id}
                  type="button"
                  className={`list-item ${version.id === selectedVersionId ? 'active' : ''}`}
                  onClick={() => selectVersion(version.id)}
                >
                  {version.name}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="panel center-panel">
          <div className="tab-row">
            <button
              type="button"
              className={`tab ${selectedTab === 'flow' ? 'active' : ''}`}
              onClick={() => setTab('flow')}
            >
              Journey Flow
            </button>
            <button
              type="button"
              className={`tab ${selectedTab === 'map' ? 'active' : ''}`}
              onClick={() => setTab('map')}
            >
              Journey Map (Phase 5)
            </button>
            <button
              type="button"
              className="btn small"
              onClick={handleAddNode}
              disabled={!selectedVersion || selectedTab !== 'flow'}
            >
              + Node
            </button>
          </div>

          {selectedTab === 'flow' ? (
            <div className="canvas">
              {selectedVersion ? (
                <ReactFlow
                  nodes={rfNodes}
                  edges={rfEdges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={handleConnect}
                  onNodeDragStop={onDragStop}
                  onNodeClick={(_, node) => selectNode(node.id)}
                  onEdgeClick={(_, edge) => selectEdge(edge.id)}
                  fitView
                >
                  <Background />
                  <MiniMap />
                  <Controls />
                </ReactFlow>
              ) : (
                <div className="canvas-empty">
                  <h3>No version selected</h3>
                  <p>Select or create artifact/version to begin.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="canvas">
              <div className="canvas-empty">
                <h3>Journey Map in Phase 5</h3>
                <p>Phase 4 focuses on fully functional Journey Flow editing.</p>
              </div>
            </div>
          )}
        </section>

        <aside className="panel right-panel">
          <h2>Inspector</h2>

          {selectedVersion ? (
            <div className="field-group">
              <label htmlFor="reviewState">Review State</label>
              <select
                id="reviewState"
                value={selectedVersion.reviewState}
                onChange={(e) => setVersionReviewState(selectedVersion.id, e.target.value as ReviewState)}
              >
                {reviewOptions().map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="muted">No version selected.</p>
          )}

          {selectedNode ? (
            <>
              <p className="muted">Selected node: {selectedNode.id}</p>
              <div className="field-group">
                <label htmlFor="nodeLabel">Label</label>
                <input
                  id="nodeLabel"
                  type="text"
                  value={selectedNode.label}
                  onChange={(e) => updateNodeLabel(selectedNode.id, e.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="nodeActor">Actor</label>
                <select
                  id="nodeActor"
                  value={selectedNode.actor}
                  onChange={(e) => updateNodeActor(selectedNode.id, e.target.value as Actor)}
                >
                  {ACTOR_OPTIONS.map((opt) => (
                    <option key={opt.value || 'unassigned'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
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
                  onChange={(e) => updateEdgeType(selectedEdge.id, e.target.value as EdgeType)}
                >
                  {EDGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="edgeLabel">Edge Label</label>
                <input
                  id="edgeLabel"
                  type="text"
                  value={selectedEdge.label ?? ''}
                  onChange={(e) => updateEdgeLabel(selectedEdge.id, e.target.value)}
                />
              </div>
            </>
          ) : (
            <p className="muted">No node/edge selected.</p>
          )}

          <h2 style={{ marginTop: 14 }}>Validation</h2>
          <div className="validation-list">
            {validation.length === 0 ? (
              <div className="validation-item info">Flow looks valid.</div>
            ) : (
              validation.map((v) => (
                <div key={`${v.code}-${v.targetId || 'global'}`} className={`validation-item ${v.severity}`}>
                  <strong>{v.code}</strong>: {v.message}
                </div>
              ))
            )}
          </div>
        </aside>
      </main>

      <footer className="statusbar">
        <span>
          Project: <strong>{selectedProject?.name ?? 'None'}</strong>
        </span>
        <span>
          Artifact: <strong>{selectedArtifact?.name ?? 'None'}</strong>
        </span>
        <span>
          Version: <strong>{selectedVersion?.name ?? 'None'}</strong>
        </span>
        <span style={{ marginLeft: 'auto' }}>
          Nodes: <strong>{currentModel?.nodes.length ?? 0}</strong> | Edges:{' '}
          <strong>{currentModel?.edges.length ?? 0}</strong>
        </span>
      </footer>
    </div>
  )
}
