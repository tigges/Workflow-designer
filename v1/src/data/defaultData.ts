import type { AppState, CanonicalModel, MapArtifact, MapVersion, Project, Workspace } from '../types'

const now = () => new Date().toISOString()

function starterModel(): CanonicalModel {
  return {
    id: 'model_support_1',
    title: 'Customer Support Flow',
    sourceDocs: [],
    nodes: [
      {
        id: 'n1',
        type: 'terminal',
        label: 'Start',
        actor: 'customer',
        origin: 'manual',
        status: 'live',
        position: { x: 60, y: 120 },
        metadata: { stage: 'Contact', touchpoint: 'Live Chat' },
      },
      {
        id: 'n2',
        type: 'process',
        label: 'Triage Request',
        actor: 'agent',
        origin: 'manual',
        status: 'live',
        position: { x: 280, y: 120 },
        metadata: { stage: 'Contact', touchpoint: 'Agent Triage' },
      },
      {
        id: 'n3',
        type: 'decision',
        label: 'Verified?',
        actor: 'agent',
        origin: 'manual',
        status: 'live',
        position: { x: 520, y: 104 },
        metadata: { stage: 'Resolution', touchpoint: 'Identity Check' },
      },
      {
        id: 'n4',
        type: 'process',
        label: 'Resolve Ticket',
        actor: 'system',
        origin: 'manual',
        status: 'live',
        position: { x: 760, y: 70 },
        metadata: { stage: 'Resolution', touchpoint: 'Backend Update', system: 'CRM' },
      },
      {
        id: 'n5',
        type: 'process',
        label: 'Request Proof',
        actor: 'agent',
        origin: 'manual',
        status: 'planned',
        position: { x: 760, y: 210 },
        metadata: { stage: 'Resolution', touchpoint: 'Follow-up Request' },
      },
      {
        id: 'n6',
        type: 'terminal',
        label: 'Closed',
        actor: 'customer',
        origin: 'manual',
        status: 'live',
        position: { x: 980, y: 70 },
        metadata: { stage: 'Follow-up', touchpoint: 'Outcome Notice' },
      },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', type: 'sequential', origin: 'manual' },
      { id: 'e2', from: 'n2', to: 'n3', type: 'sequential', origin: 'manual' },
      { id: 'e3', from: 'n3', to: 'n4', type: 'conditional', label: 'Yes', origin: 'manual' },
      { id: 'e4', from: 'n3', to: 'n5', type: 'fallback', label: 'No', origin: 'manual' },
      { id: 'e5', from: 'n4', to: 'n6', type: 'sequential', origin: 'manual' },
    ],
    confidence: {
      overall: 0.91,
      extraction: 0.91,
      synthesis: 0.91,
      validationPenalty: 0,
    },
    validation: [],
    projections: {
      flow: {
        nodePositions: {
          n1: { x: 60, y: 120 },
          n2: { x: 280, y: 120 },
          n3: { x: 520, y: 104 },
          n4: { x: 760, y: 70 },
          n5: { x: 760, y: 210 },
          n6: { x: 980, y: 70 },
        },
      },
      map: {
        nodePositions: {
          n1: { x: 40, y: 60 },
          n2: { x: 220, y: 60 },
          n3: { x: 400, y: 60 },
          n4: { x: 580, y: 30 },
          n5: { x: 580, y: 140 },
          n6: { x: 760, y: 30 },
        },
        groups: [
          { id: 'g_contact', label: 'Contact', nodeIds: ['n1', 'n2'] },
          { id: 'g_resolution', label: 'Resolution', nodeIds: ['n3', 'n4', 'n5'] },
          { id: 'g_followup', label: 'Follow-up', nodeIds: ['n6'] },
        ],
      },
    },
  }
}

export function seedState(): AppState {
  const workspace: Workspace = {
    id: 'ws_default',
    name: 'Main Workspace',
    createdAt: now(),
  }
  const project: Project = {
    id: 'proj_support',
    workspaceId: workspace.id,
    folderId: null,
    name: 'Customer Support',
    description: 'Support journeys and flows',
    createdAt: now(),
    updatedAt: now(),
  }
  const model = starterModel()
  const version: MapVersion = {
    id: 'ver_support_1',
    artifactId: 'art_support_main',
    name: 'v1',
    schemaVersion: '1.1',
    data: model,
    reviewState: 'draft',
    createdBy: 'system',
    createdAt: now(),
  }
  const artifact: MapArtifact = {
    id: 'art_support_main',
    projectId: project.id,
    name: 'Primary Flow',
    currentVersionId: version.id,
    currentApprovedVersionId: null,
    createdAt: now(),
    updatedAt: now(),
    versions: [version],
  }

  return {
    workspace,
    folders: [],
    projects: [project],
    selectedProjectId: project.id,
    artifacts: [artifact],
    selectedArtifactId: artifact.id,
    selectedVersionId: version.id,
    selectedTab: 'flow',
    selectedNodeId: null,
    selectedEdgeId: null,
    history: [JSON.parse(JSON.stringify(model)) as CanonicalModel],
    historyIndex: 0,
  }
}
