import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { score } from './score.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const expected = {
  behaviours: [{ entryPoint: 'POST /orders' }, { entryPoint: 'GET /orders' }],
  seams: [{ name: 'OrderRepository', kind: 'interface' }],
  incidental: ['README.md', 'test/orders.test.ts'],
  contractChanged: ['OrderRepository'],
  swallowed: ['sendReceipt'],
}

const ev = (symbol, status = 'verified') => ({ file: 'src/orders.ts', startLine: 1, endLine: 2, symbol, status })
const el = (id, name) => ({ id, name, level: 'component', evidence: [ev(name)] })
const step = (id, from, to, extra = {}) => ({
  id,
  order: 1,
  from,
  to,
  label: `${from} to ${to}`,
  kind: 'call',
  diff: 'unchanged',
  evidence: [ev(id)],
  ...extra,
})
const behaviour = (id, entryPointId, steps, errorFlows = []) => ({
  id,
  name: id,
  entryPointId,
  level: 'component',
  status: 'built',
  rank: { score: 1, signals: {} },
  risks: [],
  elementIds: [entryPointId],
  steps,
  errorFlows,
  seamIds: ['repo'],
})

function perfectModel() {
  return {
    version: 1,
    scope: { mode: 'pr', target: 'HEAD~1..HEAD', baseSha: 'a', headSha: 'b' },
    intent: { sources: [], isMissing: true },
    intentMismatches: [],
    elements: {
      post: el('post', 'POST /orders'),
      get: el('get', 'GET /orders/:id'),
      repo: el('repo', 'OrderRepository'),
      receipts: el('receipts', 'sendReceipt'),
      'base-old': { ...el('base-old', 'oldThing'), evidence: [ev('oldThing', 'unchecked')] },
    },
    seams: {
      repo: {
        id: 'repo',
        name: 'OrderRepository',
        kind: 'interface',
        contract: { text: 'save, findById', evidence: [ev('OrderRepository')] },
        isContractChanged: true,
      },
    },
    seamViews: {},
    behaviours: [
      behaviour('create', 'post', [step('s1', 'post', 'repo'), step('s2', 'post', 'receipts')], [
        { id: 'e1', originStepId: 's2', transforms: [], isSwallowed: true, isCatchAll: true, diff: 'unchanged' },
      ]),
      behaviour('read', 'get', [
        step('s1', 'get', 'repo'),
        // Removed Steps cite base code: excluded from the Evidence rate.
        step('s9', 'get', 'base-old', { diff: 'removed', evidence: [ev('gone', 'unchecked')] }),
      ]),
    ],
    baseBehaviours: [behaviour('read', 'get', [step('s9', 'get', 'base-old', { evidence: [ev('x', 'unchecked')] })])],
    incidentalChanges: [
      { file: 'README.md', hunk: '@@', reason: 'docs' },
      { file: 'test/orders.test.ts', hunk: '@@', reason: 'test' },
    ],
  }
}

const emptyModel = () => ({
  version: 1,
  scope: { mode: 'pr', target: 'x', headSha: 'b' },
  intent: { sources: [], isMissing: true },
  intentMismatches: [],
  elements: {},
  seams: {},
  seamViews: {},
  behaviours: [],
  incidentalChanges: [],
})

test('a perfect hand-made model passes every threshold', () => {
  const r = score(perfectModel(), expected)
  assert.equal(r.behaviourRecall, 1)
  assert.equal(r.evidenceVerifiedRate, 1)
  assert.equal(r.seamRecall, 1)
  assert.equal(r.incidentalAccuracy, 1)
  assert.equal(r.maxNodesPerView, 3)
  assert.equal(r.contractChangedRecall, 1)
  assert.equal(r.swallowedRecall, 1)
  assert.equal(r.pass, true)
})

test('an empty model fails', () => {
  const r = score(emptyModel(), expected)
  assert.equal(r.behaviourRecall, 0)
  assert.equal(r.evidenceVerifiedRate, 0)
  assert.equal(r.seamRecall, 0)
  assert.equal(r.incidentalAccuracy, 0)
  assert.equal(r.maxNodesPerView, 0)
  assert.equal(r.pass, false)
})

test('a partial model scores each metric on its own and fails', () => {
  const m = perfectModel()
  m.behaviours = m.behaviours.slice(0, 1) // GET /orders missing
  m.seams.repo.kind = 'binding' // right name, wrong kind
  m.seams.repo.isContractChanged = false
  m.incidentalChanges = m.incidentalChanges.slice(0, 1)
  m.elements.receipts.evidence = [ev('sendReceipt', 'inferred')]
  m.behaviours[0].errorFlows[0].isSwallowed = false
  const r = score(m, expected)
  assert.equal(r.behaviourRecall, 0.5)
  assert.equal(r.seamRecall, 0)
  assert.equal(r.incidentalAccuracy, 0.5)
  // Head Evidence: Elements post, repo, receipts, the Seam Contract, Steps s1, s2 = 6 items; receipts is inferred.
  // Elements no head Behaviour touches (get, base-old) are excluded.
  assert.equal(r.evidenceVerifiedRate, 5 / 6)
  assert.equal(r.contractChangedRecall, 0)
  assert.equal(r.swallowedRecall, 0)
  assert.equal(r.maxNodesPerView, 3)
  assert.equal(r.pass, false)
})

test('a view over 20 elements fails maxNodesPerView', () => {
  const m = perfectModel()
  const b = m.behaviours[0]
  for (let i = 0; i < 21; i++) {
    m.elements[`n${i}`] = el(`n${i}`, `n${i}`)
    b.steps.push(step(`x${i}`, 'post', `n${i}`))
  }
  const r = score(m, expected)
  assert.equal(r.maxNodesPerView, 24)
  assert.equal(r.pass, false)
})

test('the CLI prints the scores and exits 1 only when pass is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'how-score-'))
  const write = (name, v) => {
    const p = join(dir, name)
    writeFileSync(p, JSON.stringify(v))
    return p
  }
  const exp = write('expected.json', expected)
  const run = model => spawnSync(process.execPath, [join(here, 'score.mjs'), write('model.json', model), exp])
  const ok = run(perfectModel())
  assert.equal(ok.status, 0)
  assert.equal(JSON.parse(String(ok.stdout)).pass, true)
  const bad = run(emptyModel())
  assert.equal(bad.status, 1)
  assert.equal(JSON.parse(String(bad.stdout)).pass, false)
})
