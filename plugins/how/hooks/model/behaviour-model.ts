// Behaviour model: the contract between producer agents and the panel.
// Pure module: no I/O, no throwing. See skills/how/references/behaviour-model.md.

export type EvidenceStatus = 'verified' | 'inferred' | 'unchecked'
export type Evidence = {
  file: string
  startLine: number
  endLine: number
  symbol: string
  hunk?: string
  status: EvidenceStatus
}
export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged'
export type AbstractionLevel = 'system' | 'container' | 'component' | 'code'
export type Element = {
  id: string
  name: string
  level: AbstractionLevel
  parentId?: string
  external?: boolean
  evidence: Evidence[]
}
export type Step = {
  id: string
  order: number
  from: string
  to: string
  label: string
  kind: 'call' | 'message' | 'return' | 'effect'
  seamId?: string
  diff: DiffStatus
  evidence: Evidence[]
}
export type Seam = {
  id: string
  name: string
  kind: 'interface' | 'module-api' | 'network' | 'message' | 'binding'
  contract: { text: string; evidence: Evidence[] }
  enablingPoint?: Evidence
  isContractChanged: boolean
}
export type ErrorFlow = {
  id: string
  originStepId: string
  transforms: { seamId: string; into: string; evidence: Evidence[] }[]
  handler?: { elementId: string; evidence: Evidence[] }
  isSwallowed: boolean
  isCatchAll: boolean
  diff: DiffStatus
}
export type BuildStatus = 'built' | 'pending' | 'building' | 'failed'
export type Behaviour = {
  id: string
  name: string
  entryPointId: string
  level: AbstractionLevel
  status: BuildStatus
  rank: { score: number; signals: Record<string, number> }
  risks: ('contract-change' | 'error-handling-change' | 'high-fan-in')[]
  elementIds: string[]
  steps: Step[]
  errorFlows: ErrorFlow[]
  seamIds: string[]
}
export type FlowNode = {
  id: string
  label: string
  kind: 'step' | 'decision' | 'error' | 'return'
  diff: DiffStatus
  evidence: Evidence[]
}
export type SeamView = {
  subjectId: string
  status: BuildStatus
  nodes: FlowNode[]
  edges: { from: string; to: string; label?: string; isError: boolean }[]
}
export type BehaviourModel = {
  version: 1
  scope: { mode: 'pr' | 'codebase'; target: string; baseSha?: string; headSha: string; focus?: string }
  intent: { text?: string; sources: string[]; isMissing: boolean }
  intentMismatches: { claim: string; observed: string; evidence: Evidence[] }[]
  behaviours: Behaviour[]
  elements: Record<string, Element>
  seams: Record<string, Seam>
  seamViews: Record<string, SeamView> // keyed by element id or seam id
  incidentalChanges: { file: string; hunk: string; reason: 'refactor' | 'test' | 'config' | 'docs' | 'other' }[]
  baseBehaviours?: Behaviour[] // PR mode: the same Behaviours at base, matched by entry point element name
}

export type ParseResult = { model: BehaviourModel } | { error: string }

const EVIDENCE_STATUS = ['verified', 'inferred', 'unchecked']
const DIFF = ['added', 'removed', 'changed', 'unchanged']
const LEVEL = ['system', 'container', 'component', 'code']
const STEP_KIND = ['call', 'message', 'return', 'effect']
const SEAM_KIND = ['interface', 'module-api', 'network', 'message', 'binding']
const BUILD = ['built', 'pending', 'building', 'failed']
const RISK = ['contract-change', 'error-handling-change', 'high-fan-in']
const FLOW_KIND = ['step', 'decision', 'error', 'return']
const REASON = ['refactor', 'test', 'config', 'docs', 'other']

class Invalid extends Error {}
const fail = (msg: string): never => {
  throw new Invalid(msg)
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function obj(v: unknown, what: string): Obj {
  return isObj(v) ? v : fail(`${what} must be an object`)
}
function arr(v: unknown, what: string): unknown[] {
  return Array.isArray(v) ? v : fail(`${what} must be an array`)
}
function str(o: Obj, key: string, what: string): string {
  const v = o[key]
  return typeof v === 'string' ? v : fail(`${what} needs a string "${key}"`)
}
function num(o: Obj, key: string, what: string): number {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} needs a numeric "${key}"`)
}
function bool(o: Obj, key: string, what: string): boolean {
  const v = o[key]
  return typeof v === 'boolean' ? v : fail(`${what} needs a boolean "${key}"`)
}
function oneOf(o: Obj, key: string, allowed: string[], what: string): string {
  const v = o[key]
  return typeof v === 'string' && allowed.includes(v)
    ? v
    : fail(`${what} has invalid "${key}" ${JSON.stringify(v)}; expected one of ${allowed.join(', ')}`)
}
function optStr(o: Obj, key: string, what: string): void {
  if (o[key] !== undefined && typeof o[key] !== 'string') fail(`${what} "${key}" must be a string`)
}

function checkEvidence(v: unknown, what: string): void {
  const e = obj(v, `Evidence of ${what}`)
  const w = `Evidence of ${what}`
  str(e, 'file', w)
  num(e, 'startLine', w)
  num(e, 'endLine', w)
  str(e, 'symbol', w)
  optStr(e, 'hunk', w)
  oneOf(e, 'status', EVIDENCE_STATUS, w)
}
function checkEvidenceList(o: Obj, key: string, what: string): void {
  arr(o[key], `${what} "${key}"`).forEach(e => checkEvidence(e, what))
}
function strList(v: unknown, what: string): string[] {
  return arr(v, what).map(x => (typeof x === 'string' ? x : fail(`${what} must hold only strings`)))
}

function checkElement(key: string, v: unknown): void {
  const w = `Element "${key}"`
  const o = obj(v, w)
  const id = str(o, 'id', w)
  if (id !== key) fail(`${w} has id "${id}" that differs from its key`)
  str(o, 'name', w)
  oneOf(o, 'level', LEVEL, w)
  optStr(o, 'parentId', w)
  if (o.external !== undefined && typeof o.external !== 'boolean') fail(`${w} "external" must be a boolean`)
  checkEvidenceList(o, 'evidence', w)
}

function checkSeam(key: string, v: unknown): void {
  const w = `Seam "${key}"`
  const o = obj(v, w)
  const id = str(o, 'id', w)
  if (id !== key) fail(`${w} has id "${id}" that differs from its key`)
  str(o, 'name', w)
  oneOf(o, 'kind', SEAM_KIND, w)
  const c = obj(o.contract, `Contract of ${w}`)
  str(c, 'text', `Contract of ${w}`)
  checkEvidenceList(c, 'evidence', `Contract of ${w}`)
  if (o.enablingPoint !== undefined) checkEvidence(o.enablingPoint, `Enabling point of ${w}`)
  bool(o, 'isContractChanged', w)
}

function checkSeamView(key: string, v: unknown, elements: Obj, seams: Obj): void {
  const w = `Seam view "${key}"`
  const o = obj(v, w)
  const subject = str(o, 'subjectId', w)
  if (!Object.hasOwn(elements, subject) && !Object.hasOwn(seams, subject)) fail(`${w} subject "${subject}" names no Element or Seam`)
  oneOf(o, 'status', BUILD, w)
  const ids = new Set<string>()
  arr(o.nodes, `${w} nodes`).forEach(n => {
    const nw = `Flow node in ${w}`
    const no = obj(n, nw)
    const id = str(no, 'id', nw)
    if (ids.has(id)) fail(`${w} has duplicate flow node id "${id}"`)
    ids.add(id)
    str(no, 'label', `Flow node "${id}"`)
    oneOf(no, 'kind', FLOW_KIND, `Flow node "${id}"`)
    oneOf(no, 'diff', DIFF, `Flow node "${id}"`)
    checkEvidenceList(no, 'evidence', `Flow node "${id}"`)
  })
  arr(o.edges, `${w} edges`).forEach(e => {
    const eo = obj(e, `Edge in ${w}`)
    const from = str(eo, 'from', `Edge in ${w}`)
    const to = str(eo, 'to', `Edge in ${w}`)
    if (!ids.has(from) || !ids.has(to)) fail(`Edge ${from} -> ${to} in ${w} names no flow node`)
    optStr(eo, 'label', `Edge in ${w}`)
    bool(eo, 'isError', `Edge in ${w}`)
  })
}

function checkBehaviour(v: unknown, elements: Obj, seams: Obj, where: string): void {
  const o0 = obj(v, `Behaviour in ${where}`)
  const bid = str(o0, 'id', `Behaviour in ${where}`)
  const w = `Behaviour "${bid}"`
  const o = o0
  str(o, 'name', w)
  const entry = str(o, 'entryPointId', w)
  oneOf(o, 'level', LEVEL, w)
  oneOf(o, 'status', BUILD, w)
  const rank = obj(o.rank, `Rank of ${w}`)
  num(rank, 'score', `Rank of ${w}`)
  const signals = obj(rank.signals, `Rank signals of ${w}`)
  for (const [k, s] of Object.entries(signals)) {
    if (typeof s !== 'number') fail(`Rank signal "${k}" of ${w} must be a number`)
  }
  arr(o.risks, `${w} risks`).forEach(r => {
    if (typeof r !== 'string' || !RISK.includes(r)) fail(`${w} has invalid risk ${JSON.stringify(r)}`)
  })
  const elementIds = strList(o.elementIds, `${w} elementIds`)
  elementIds.forEach(id => {
    if (!Object.hasOwn(elements, id)) fail(`${w} lists elementId "${id}" that names no Element`)
  })
  if (!elementIds.includes(entry)) fail(`${w} entry point "${entry}" is missing from its elementIds`)
  const seamIds = strList(o.seamIds, `${w} seamIds`)
  seamIds.forEach(id => {
    if (!Object.hasOwn(seams, id)) fail(`${w} lists seamId "${id}" that names no Seam`)
  })
  const stepIds = new Set<string>()
  arr(o.steps, `${w} steps`).forEach(s => {
    const sid0 = obj(s, `Step in ${w}`)
    const sid = str(sid0, 'id', `Step in ${w}`)
    const sw = `Step "${sid}" of ${w}`
    if (stepIds.has(sid)) fail(`${w} has duplicate step id "${sid}"`)
    stepIds.add(sid)
    num(sid0, 'order', sw)
    const from = str(sid0, 'from', sw)
    const to = str(sid0, 'to', sw)
    if (!Object.hasOwn(elements, from)) fail(`${sw} "from" "${from}" names no Element`)
    if (!Object.hasOwn(elements, to)) fail(`${sw} "to" "${to}" names no Element`)
    str(sid0, 'label', sw)
    oneOf(sid0, 'kind', STEP_KIND, sw)
    optStr(sid0, 'seamId', sw)
    if (typeof sid0.seamId === 'string' && !Object.hasOwn(seams, sid0.seamId)) {
      fail(`${sw} seamId "${sid0.seamId}" names no Seam`)
    }
    oneOf(sid0, 'diff', DIFF, sw)
    checkEvidenceList(sid0, 'evidence', sw)
  })
  const flowIds = new Set<string>()
  arr(o.errorFlows, `${w} errorFlows`).forEach(f => {
    const fo = obj(f, `Error flow in ${w}`)
    const fid = str(fo, 'id', `Error flow in ${w}`)
    const fw = `Error flow "${fid}" of ${w}`
    if (flowIds.has(fid)) fail(`${w} has duplicate error flow id "${fid}"`)
    flowIds.add(fid)
    const origin = str(fo, 'originStepId', fw)
    if (!stepIds.has(origin)) fail(`${fw} origin step "${origin}" names no step`)
    arr(fo.transforms, `${fw} transforms`).forEach(t => {
      const to = obj(t, `Transform in ${fw}`)
      const sm = str(to, 'seamId', `Transform in ${fw}`)
      if (!Object.hasOwn(seams, sm)) fail(`Transform in ${fw} seamId "${sm}" names no Seam`)
      str(to, 'into', `Transform in ${fw}`)
      checkEvidenceList(to, 'evidence', `Transform in ${fw}`)
    })
    if (fo.handler !== undefined) {
      const h = obj(fo.handler, `Handler of ${fw}`)
      const el = str(h, 'elementId', `Handler of ${fw}`)
      if (!Object.hasOwn(elements, el)) fail(`Handler of ${fw} elementId "${el}" names no Element`)
      checkEvidenceList(h, 'evidence', `Handler of ${fw}`)
    }
    bool(fo, 'isSwallowed', fw)
    bool(fo, 'isCatchAll', fw)
    oneOf(fo, 'diff', DIFF, fw)
  })
}

function validate(raw: unknown): BehaviourModel {
  const root = obj(raw, 'Behaviour model')
  if (root.version !== 1) fail(`unsupported Behaviour model version ${String(root.version)}`)

  const scope = obj(root.scope, 'Behaviour model scope')
  oneOf(scope, 'mode', ['pr', 'codebase'], 'Behaviour model scope')
  str(scope, 'target', 'Behaviour model scope')
  str(scope, 'headSha', 'Behaviour model scope')
  optStr(scope, 'baseSha', 'Behaviour model scope')
  optStr(scope, 'focus', 'Behaviour model scope')

  const intent = obj(root.intent, 'Behaviour model intent')
  optStr(intent, 'text', 'Behaviour model intent')
  strList(intent.sources, 'Behaviour model intent sources')
  bool(intent, 'isMissing', 'Behaviour model intent')

  arr(root.intentMismatches, 'intentMismatches').forEach((m, i) => {
    const w = `Intent mismatch ${i}`
    const mo = obj(m, w)
    str(mo, 'claim', w)
    str(mo, 'observed', w)
    checkEvidenceList(mo, 'evidence', w)
  })

  const elements = obj(root.elements, 'Behaviour model elements')
  for (const [k, e] of Object.entries(elements)) checkElement(k, e)
  const seams = obj(root.seams, 'Behaviour model seams')
  for (const [k, s] of Object.entries(seams)) checkSeam(k, s)
  for (const [k, e] of Object.entries(elements)) {
    const p = (e as Obj).parentId
    if (typeof p === 'string' && !Object.hasOwn(elements, p)) fail(`Element "${k}" parentId "${p}" names no Element`)
  }
  const seamViews = obj(root.seamViews, 'Behaviour model seamViews')
  for (const [k, sv] of Object.entries(seamViews)) checkSeamView(k, sv, elements, seams)

  const seen = new Set<string>()
  arr(root.behaviours, 'behaviours').forEach(b => {
    checkBehaviour(b, elements, seams, 'behaviours')
    const id = (b as Obj).id as string
    if (seen.has(id)) fail(`duplicate Behaviour id "${id}"`)
    seen.add(id)
  })
  if (root.baseBehaviours !== undefined) {
    const seenBase = new Set<string>()
    arr(root.baseBehaviours, 'baseBehaviours').forEach(b => {
      checkBehaviour(b, elements, seams, 'baseBehaviours')
      const id = (b as Obj).id as string
      if (seenBase.has(id)) fail(`duplicate base Behaviour id "${id}"`)
      seenBase.add(id)
    })
  }

  arr(root.incidentalChanges, 'incidentalChanges').forEach((c, i) => {
    const w = `Incidental change ${i}`
    const co = obj(c, w)
    str(co, 'file', w)
    str(co, 'hunk', w)
    oneOf(co, 'reason', REASON, w)
  })

  return raw as BehaviourModel
}

export function parseBehaviourModel(json: string): ParseResult {
  try {
    return { model: validate(JSON.parse(json)) }
  } catch (e) {
    if (e instanceof Invalid) return { error: e.message }
    if (e instanceof SyntaxError) return { error: `Behaviour model is not valid JSON: ${e.message}` }
    return { error: `Behaviour model could not be parsed: ${String(e)}` }
  }
}
