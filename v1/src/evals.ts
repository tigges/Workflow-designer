import type { CanonicalModel, FlowNode } from './types'

export type GoldImportFixture = {
  id: string
  label: string
  tocInput: string
  chapterInput: string
  goldClusters: string[]
  goldSteps: string[]
  goldAssignments: Record<string, string>
  goldDecisionSteps: string[]
  limits?: {
    maxReasonableNodes?: number
    maxReasonableEdges?: number
  }
}

export type ImportEvalMetrics = {
  clusterPrecision: number
  clusterRecall: number
  stepExtractionRecall: number
  assignmentAccuracy: number
  decisionPrecision: number
  decisionRecall: number
  decisionF1: number
  unassignedRate: number
  nodeExplosionRate: number
  manualEditsNeededToApprove: number
  predictedNodeCount: number
  predictedEdgeCount: number
  goldStepCount: number
}

const WITHDRAWAL_STEPS = [
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
]

const WITHDRAWAL_ASSIGNMENTS: Record<string, string> = Object.fromEntries(
  WITHDRAWAL_STEPS.map((step) => [step, 'Withdrawals & Cashier']),
)

const WITHDRAWAL_DECISIONS = WITHDRAWAL_STEPS.filter((step) => /^Decision:/i.test(step))

const SUPPORT_STEPS = [
  'Start: Customer submits support ticket.',
  'Classify issue category and urgency.',
  'Decision: Is issue resolved by known workaround?',
  'Provide workaround instructions and confirm resolution.',
  'Decision: Is specialist escalation required?',
  'Escalate ticket to specialist queue with evidence.',
  'Follow up with customer on resolution outcome.',
  'End: Ticket resolved or handed off.',
]

const SUPPORT_ASSIGNMENTS: Record<string, string> = {
  'Start: Customer submits support ticket.': 'User Data & Support Issues',
  'Classify issue category and urgency.': 'User Data & Support Issues',
  'Decision: Is issue resolved by known workaround?': 'User Data & Support Issues',
  'Provide workaround instructions and confirm resolution.': 'User Data & Support Issues',
  'Decision: Is specialist escalation required?': 'User Data & Support Issues',
  'Escalate ticket to specialist queue with evidence.': 'User Data & Support Issues',
  'Follow up with customer on resolution outcome.': 'User Data & Support Issues',
  'End: Ticket resolved or handed off.': 'User Data & Support Issues',
}

const SUPPORT_DECISIONS = SUPPORT_STEPS.filter((step) => /^Decision:/i.test(step))

const BASE_CLUSTERS = [
  'Core Concepts & Account Management',
  'User Data & Support Issues',
  'Payments & Deposits',
  'Withdrawals & Cashier',
  'Verification & Risk',
  'Bonuses & Gamification',
  'Sports Betting',
  'Account Status & Safety',
]

export const GOLD_IMPORT_FIXTURES: GoldImportFixture[] = [
  {
    id: 'withdrawal_v1',
    label: 'Gold: Withdrawal chapter',
    tocInput: BASE_CLUSTERS.map((cluster) => `Cluster: ${cluster}`).join('\n'),
    chapterInput: WITHDRAWAL_STEPS.join('\n'),
    goldClusters: BASE_CLUSTERS,
    goldSteps: WITHDRAWAL_STEPS,
    goldAssignments: WITHDRAWAL_ASSIGNMENTS,
    goldDecisionSteps: WITHDRAWAL_DECISIONS,
    limits: {
      maxReasonableNodes: 24,
      maxReasonableEdges: 28,
    },
  },
  {
    id: 'support_v1',
    label: 'Gold: Support chapter',
    tocInput: BASE_CLUSTERS.map((cluster) => `Cluster: ${cluster}`).join('\n'),
    chapterInput: SUPPORT_STEPS.join('\n'),
    goldClusters: BASE_CLUSTERS,
    goldSteps: SUPPORT_STEPS,
    goldAssignments: SUPPORT_ASSIGNMENTS,
    goldDecisionSteps: SUPPORT_DECISIONS,
    limits: {
      maxReasonableNodes: 16,
      maxReasonableEdges: 18,
    },
  },
]

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/^cluster:\s*/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nodeText(node: FlowNode): string {
  const notes = node.metadata.notes?.trim()
  return notes ? `${node.label}; ${notes}` : node.label
}

function uniqueNormalized(values: string[]): string[] {
  const seen = new Set<string>()
  values.forEach((value) => {
    const normalized = normalize(value)
    if (normalized) seen.add(normalized)
  })
  return [...seen]
}

function f1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

function toFixed(value: number): number {
  return Number(value.toFixed(4))
}

export function evaluateImportQuality(
  fixture: GoldImportFixture,
  model: CanonicalModel,
): ImportEvalMetrics {
  const predictedStepNodes = model.nodes.filter((node) => node.type !== 'annotation')
  const predictedSteps = predictedStepNodes.map((node) => nodeText(node))
  const goldStepSet = new Set(uniqueNormalized(fixture.goldSteps))
  const predictedStepSet = new Set(uniqueNormalized(predictedSteps))
  const matchedSteps = [...goldStepSet].filter((step) => predictedStepSet.has(step)).length
  const stepExtractionRecall = goldStepSet.size === 0 ? 0 : matchedSteps / goldStepSet.size

  const predictedClusters = uniqueNormalized([
    ...(model.projections.map.groups?.map((group) => group.label) ?? []),
    ...predictedStepNodes
      .map((node) => node.metadata.stage ?? '')
      .filter((value) => value.trim().length > 0),
  ])
  const goldClusters = uniqueNormalized(fixture.goldClusters)
  const clusterMatches = predictedClusters.filter((cluster) => goldClusters.includes(cluster)).length
  const clusterPrecision = predictedClusters.length === 0 ? 0 : clusterMatches / predictedClusters.length
  const clusterRecall = goldClusters.length === 0 ? 0 : clusterMatches / goldClusters.length

  const predictedAssignments = new Map<string, string>()
  predictedStepNodes.forEach((node) => {
    predictedAssignments.set(normalize(nodeText(node)), normalize(node.metadata.stage ?? ''))
  })
  const assignmentEntries = Object.entries(fixture.goldAssignments)
  const assignmentChecks = assignmentEntries
    .map(([step, cluster]) => {
      const predictedCluster = predictedAssignments.get(normalize(step))
      if (!predictedCluster) return null
      return predictedCluster === normalize(cluster)
    })
    .filter((value): value is boolean => value !== null)
  const assignmentAccuracy =
    assignmentChecks.length === 0
      ? 0
      : assignmentChecks.filter(Boolean).length / assignmentChecks.length

  const goldDecisionSet = new Set(uniqueNormalized(fixture.goldDecisionSteps))
  const predictedDecisionSet = new Set(
    uniqueNormalized(
      predictedStepNodes.filter((node) => node.type === 'decision').map((node) => nodeText(node)),
    ),
  )
  const decisionMatches = [...predictedDecisionSet].filter((step) => goldDecisionSet.has(step)).length
  const decisionPrecision =
    predictedDecisionSet.size === 0 ? 0 : decisionMatches / predictedDecisionSet.size
  const decisionRecall = goldDecisionSet.size === 0 ? 0 : decisionMatches / goldDecisionSet.size
  const decisionF1 = f1(decisionPrecision, decisionRecall)

  const unassigned = predictedStepNodes.filter((node) => {
    const stage = normalize(node.metadata.stage ?? '')
    return !stage || stage.includes('unassigned')
  }).length
  const unassignedRate = predictedStepNodes.length === 0 ? 0 : unassigned / predictedStepNodes.length

  const nodeExplosionRate =
    fixture.goldSteps.length === 0 ? 0 : predictedStepNodes.length / fixture.goldSteps.length
  const manualEditsNeededToApprove = Math.max(
    0,
    Math.round((1 - assignmentAccuracy) * fixture.goldSteps.length + unassigned),
  )

  return {
    clusterPrecision: toFixed(clusterPrecision),
    clusterRecall: toFixed(clusterRecall),
    stepExtractionRecall: toFixed(stepExtractionRecall),
    assignmentAccuracy: toFixed(assignmentAccuracy),
    decisionPrecision: toFixed(decisionPrecision),
    decisionRecall: toFixed(decisionRecall),
    decisionF1: toFixed(decisionF1),
    unassignedRate: toFixed(unassignedRate),
    nodeExplosionRate: toFixed(nodeExplosionRate),
    manualEditsNeededToApprove,
    predictedNodeCount: predictedStepNodes.length,
    predictedEdgeCount: model.edges.length,
    goldStepCount: fixture.goldSteps.length,
  }
}
