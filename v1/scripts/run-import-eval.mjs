import { execSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

class MemoryStorage {
  #store = new Map()

  getItem(key) {
    return this.#store.has(key) ? this.#store.get(key) : null
  }

  setItem(key, value) {
    this.#store.set(key, value)
  }

  removeItem(key) {
    this.#store.delete(key)
  }

  clear() {
    this.#store.clear()
  }
}

function avg(values) {
  if (values.length === 0) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
}

async function resolveParserVersion() {
  const packagePath = path.resolve(process.cwd(), 'package.json')
  const content = await readFile(packagePath, 'utf8')
  const parsed = JSON.parse(content)
  return parsed.version ?? '0.0.0'
}

function resolveGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function pickFixturesByArg(fixtures) {
  const requested = process.argv.find((arg) => arg.startsWith('--fixture='))?.split('=')[1]?.trim()
  if (!requested) return fixtures
  const match = fixtures.find((fixture) => fixture.id === requested)
  if (!match) {
    throw new Error(
      `Unknown fixture "${requested}". Available: ${fixtures.map((fixture) => fixture.id).join(', ')}`,
    )
  }
  return [match]
}

async function run() {
  globalThis.localStorage = new MemoryStorage()
  const [{ GOLD_IMPORT_FIXTURES, evaluateImportQuality }, { usePMStore }] = await Promise.all([
    import('../src/evals.ts'),
    import('../src/store.ts'),
  ])
  const fixtures = pickFixturesByArg(GOLD_IMPORT_FIXTURES)
  const parserVersion = await resolveParserVersion()
  const gitSha = resolveGitSha()
  const runId = `import-eval-${Date.now()}`
  const runs = []

  for (const fixture of fixtures) {
    const clearResult = usePMStore.getState().clearCurrentVersion()
    if (!clearResult.ok) {
      throw new Error(`Failed clearing version before fixture ${fixture.id}: ${clearResult.message}`)
    }

    usePMStore.getState().importFromText(fixture.tocInput)
    usePMStore.getState().importFromAiAssist(fixture.chapterInput)
    const model = usePMStore.getState().getCurrentModel()
    if (!model) throw new Error(`No model returned after fixture ${fixture.id}`)

    const metrics = evaluateImportQuality(fixture, model)
    const nodeLimit = fixture.limits?.maxReasonableNodes
    const edgeLimit = fixture.limits?.maxReasonableEdges
    runs.push({
      fixtureId: fixture.id,
      label: fixture.label,
      metrics,
      limitStatus: {
        nodeCountWithinLimit: nodeLimit ? metrics.predictedNodeCount <= nodeLimit : true,
        edgeCountWithinLimit: edgeLimit ? metrics.predictedEdgeCount <= edgeLimit : true,
      },
    })
  }

  const summary = {
    runId,
    createdAt: new Date().toISOString(),
    gitSha,
    parserVersion,
    fixtureCount: runs.length,
    runs,
    aggregate: {
      avgClusterRecall: avg(runs.map((run) => run.metrics.clusterRecall)),
      avgStepExtractionRecall: avg(runs.map((run) => run.metrics.stepExtractionRecall)),
      avgAssignmentAccuracy: avg(runs.map((run) => run.metrics.assignmentAccuracy)),
      avgDecisionF1: avg(runs.map((run) => run.metrics.decisionF1)),
      avgUnassignedRate: avg(runs.map((run) => run.metrics.unassignedRate)),
      avgNodeExplosionRate: avg(runs.map((run) => run.metrics.nodeExplosionRate)),
      avgManualEditsNeededToApprove: avg(runs.map((run) => run.metrics.manualEditsNeededToApprove)),
    },
  }

  const outputDir = path.resolve(process.cwd(), 'evals/history')
  await mkdir(outputDir, { recursive: true })
  await writeFile(path.join(outputDir, 'latest-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  await writeFile(path.join(outputDir, `${runId}.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  const lines = [
    `Import eval run: ${summary.runId}`,
    `Parser version: ${summary.parserVersion}`,
    `Git SHA: ${summary.gitSha}`,
    `Fixtures: ${summary.fixtureCount}`,
    ...summary.runs.map(
      (run) =>
        `${run.fixtureId}: clusterR=${run.metrics.clusterRecall} stepR=${run.metrics.stepExtractionRecall} assignAcc=${run.metrics.assignmentAccuracy} decisionF1=${run.metrics.decisionF1} unassigned=${run.metrics.unassignedRate} explosion=${run.metrics.nodeExplosionRate} edits=${run.metrics.manualEditsNeededToApprove}`,
    ),
    `Aggregate: clusterR=${summary.aggregate.avgClusterRecall} stepR=${summary.aggregate.avgStepExtractionRecall} assignAcc=${summary.aggregate.avgAssignmentAccuracy} decisionF1=${summary.aggregate.avgDecisionF1} unassigned=${summary.aggregate.avgUnassignedRate} explosion=${summary.aggregate.avgNodeExplosionRate} edits=${summary.aggregate.avgManualEditsNeededToApprove}`,
    `Wrote: ${path.join(outputDir, 'latest-summary.json')}`,
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Import eval failed: ${message}\n`)
  process.exit(1)
})
