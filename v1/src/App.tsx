import { useEffect, useMemo, useState, type MouseEvent } from 'react'
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
  MapArtifact,
  MapVersion,
  ReviewState,
} from './types'

type RFNodeData = {
  label: string
  actor: Actor
  kind: FlowNode['type']
  status: FlowNode['status']
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

const FEATURE_AVAILABILITY = {
  templates: false,
  aiAssist: false,
  importJson: false,
} as const

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

function FlowNodeView({ data }: NodeProps<Node<RFNodeData>>) {
  return (
    <div className={`fnode-card kind-${data.kind}`}>
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
  const [aiPrompt, setAiPrompt] = useState('')
  const [headerNotice, setHeaderNotice] = useState('')

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

  useEffect(() => {
    setRfNodes(rfNodeSeed)
    setRfEdges(rfEdgeSeed)
  }, [rfNodeSeed, rfEdgeSeed, setRfNodes, setRfEdges])

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

  function handleAddNode(type: FlowNode['type']) {
    if (!currentModel) return
    const node = buildDefaultNode(currentModel.nodes.length, type)
    addNodeToCurrentVersion(node)
  }

  function handleConnect(conn: Connection) {
    if (!conn.source || !conn.target) return
    const edge = buildDefaultEdge(conn.source, conn.target)
    edge.type = activeEdgeType
    addEdgeToCurrentVersion(edge)
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
    const warnOrErrorCount = validation.filter((item) => item.severity !== 'info').length
    setHeaderNotice(
      warnOrErrorCount === 0
        ? 'Validation passed. No issues found.'
        : `Validation found ${warnOrErrorCount} issue${warnOrErrorCount > 1 ? 's' : ''}.`,
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

  function handleImportJson(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.[0]) {
      setHeaderNotice(`Selected ${event.target.files[0].name}. Import adapter will be connected soon.`)
      return
    }
    setHeaderNotice('Import adapter will be connected in a following phase.')
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
          <button type="button" className="btn" onClick={handleValidateClick}>
            Validate
          </button>
          <button type="button" className="btn" onClick={handleExportJson}>
            Export JSON
          </button>
          <button type="button" className="btn primary" onClick={handleExportSvg}>
            Export SVG
          </button>
          <label
            className={`btn import-btn ${!FEATURE_AVAILABILITY.importJson ? 'preview-feature' : ''}`}
            onClick={(event) => {
              if (!FEATURE_AVAILABILITY.importJson) handlePreviewClick(event, 'Import JSON')
            }}
          >
            Import JSON
            <input
              type="file"
              accept="application/json"
              onChange={handleImportJson}
              disabled={!FEATURE_AVAILABILITY.importJson}
            />
          </label>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
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
                  if (!FEATURE_AVAILABILITY.aiAssist) handlePreviewClick(event, 'AI Assist')
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
          </section>

          <section className="sb-sec">
            <div className="sb-row">
              <div className="sb-label">Projects</div>
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
          </section>

          <section className="sb-sec">
            <div className="sb-row">
              <div className="sb-label">Artifacts</div>
              <button type="button" className="tiny-btn" onClick={handleCreateArtifact} disabled={!selectedProject}>
                + add
              </button>
            </div>
            <div className="stack-list">
              {projectArtifacts.map((artifact: MapArtifact) => (
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
          </section>

          <section className="sb-sec">
            <div className="sb-row">
              <div className="sb-label">Versions</div>
              <button type="button" className="tiny-btn" onClick={handleCreateVersion} disabled={!selectedArtifact}>
                + add
              </button>
            </div>
            <div className="stack-list">
              {versions.map((version: MapVersion) => (
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
          </section>

          <section className="sb-sec">
            <div className="sb-label">Node Types</div>
            {NODE_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="pal-card"
                onClick={() => handleAddNode(opt.value)}
                disabled={!selectedVersion || selectedTab !== 'flow'}
              >
                <span className={`pal-shape shape-${opt.value}`} />
                <span className="pal-info">
                  <span className="pal-name">{opt.label}</span>
                  <span className="pal-desc">{opt.desc}</span>
                </span>
              </button>
            ))}
          </section>

          <section className="sb-sec">
            <div className="sb-label">Connection Type</div>
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
          </section>

          <section className="sb-sec">
            <div className="sb-label">Validation</div>
            <div className="val-list">
              {validation.length === 0 ? (
                <div className="val-row ok">Canvas ready</div>
              ) : (
                validation.map((issue) => (
                  <div key={`${issue.code}-${issue.targetId || 'global'}`} className={`val-row ${issue.severity}`}>
                    {issue.code}: {issue.message}
                  </div>
                ))
              )}
            </div>
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
              disabled={!selectedVersion || selectedTab !== 'flow'}
            >
              + Process Node
            </button>
            <span className="flow-hint">Tip: drag from node handle to connect</span>
          </div>

          <div className="canvas-wrap">
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

          {selectedVersion ? (
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
            </>
          ) : (
            <p className="muted">Select a node or connection to edit properties.</p>
          )}

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
        </aside>
      </main>

      <footer className="statusbar">
        <span className="sb-val">{currentModel?.nodes.length ?? 0} nodes</span>
        <span className="sb-sep">|</span>
        <span>{currentModel?.edges.length ?? 0} connections</span>
        <span className="sb-sep">|</span>
        <span>{selectedTab}</span>
        <span className="sb-hint">{headerNotice || 'Drag nodes to canvas - connect with handles - edit in right panel'}</span>
      </footer>
    </div>
  )
}
