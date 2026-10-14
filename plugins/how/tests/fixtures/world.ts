// A test world beneath the plugin for the model tools and drill-down: files, realPaths, the cwd, the pane, agent
// spawns and the session's start and turn ends, all answered from memory.
import type { On } from 'claude-code'
import { type BehaviourModel, parseBehaviourModel } from '../../hooks/model/behaviour-model'

export const CWD = '/work/repo'
export const MODEL_PATH = `${CWD}/.git/how/9be2d41c7a85.json`

export const load = (json: string): BehaviourModel => {
  const r = parseBehaviourModel(json)
  if ('error' in r) throw new Error(r.error)
  return r.model
}
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Source files in which every cited symbol is found on every cited line, so all Evidence verifies. */
export function sourcesFor(model: unknown): Record<string, string> {
  const byFile = new Map<string, { symbols: Set<string>; lines: number }>()
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.file === 'string' && typeof o.symbol === 'string' && typeof o.endLine === 'number') {
        const f = byFile.get(o.file) ?? { symbols: new Set<string>(), lines: 0 }
        f.symbols.add(o.symbol)
        f.lines = Math.max(f.lines, o.endLine + 5)
        byFile.set(o.file, f)
      }
      Object.values(o).forEach(walk)
    }
  }
  walk(model)
  const out: Record<string, string> = {}
  for (const [file, f] of byFile) out[file] = Array.from({ length: f.lines }, () => [...f.symbols].join(' ')).join('\n')
  return out
}

export type World = {
  files: Record<string, string>
  /** realPath overrides by file (a symlink leading elsewhere). */
  links: Record<string, string>
  reads: string[]
  writes: { path: string; text: string }[]
  opened: unknown[]
  spawns: { prompt: string; description?: string; subagentType?: string }[]
  /** What each spawn answers, in order; the last repeats. */
  spawnAnswers: ({ agentId: string } | { deny: string })[]
}

const fileOf = (w: World, path: string) =>
  Object.keys(w.files).find(f => path === f || path.endsWith(`/${f}`) || (f.startsWith('/') && path === f))

/** Registers the world's bottom hooks; relative paths reach a hook already resolved, so files match by suffix. */
export function world(on: On, init: Partial<World> = {}): World {
  const w: World = {
    files: {},
    links: {},
    reads: [],
    writes: [],
    opened: [],
    spawns: [],
    spawnAnswers: [{ agentId: 'agent-1' }],
    ...init,
  }
  on('fs.read', async (_$, e) => {
    const path = String((e as { path: string }).path)
    w.reads.push(path)
    const f = fileOf(w, path)
    return f === undefined ? { deny: `ENOENT: ${path}` } : { value: w.files[f]! }
  })
  on('fs.write', async (_$, e) => {
    const { path, text } = e as { path: string; text: string }
    w.writes.push({ path, text })
    w.files[path] = text
    return { value: undefined }
  })
  on('fs.stat', async (_$, e) => {
    const path = String((e as { path: string }).path)
    const stat = { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }
    if (path === CWD) return { value: { ...stat, kind: 'dir' as const, realPath: CWD } }
    const f = fileOf(w, path)
    if (f === undefined) return { deny: `ENOENT: ${path}` }
    const real = w.links[f] ?? (f.startsWith('/') ? f : `${CWD}/${f}`)
    return { value: { ...stat, isLink: f in w.links, realPath: real } }
  })
  on('session.cwd', async () => ({ value: CWD }))
  on('ui.open', async (_$, e) => {
    w.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('agent.spawn', async (_$, e) => {
    // Beneath the plugins the spawn arrives as the Agent tool's input (subagent_type) in this build.
    const x = e as { prompt: string; description?: string; subagentType?: string; subagent_type?: string }
    w.spawns.push({ prompt: x.prompt, description: x.description, subagentType: x.subagentType ?? x.subagent_type })
    const a = w.spawnAnswers[Math.min(w.spawns.length - 1, w.spawnAnswers.length - 1)]!
    if ('deny' in a) return { deny: a.deny }
    // This build's kit reads the started agent's id from the Agent tool's record beside `model` (an `agentId`
    // answered by a hook is core's to set and is dropped).
    return { model: 'test', result: { agentId: a.agentId } } as never
  })
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }))
  on('turn.complete', async () => ({ text: '' }))
  return w
}

/** The model the plugin last wrote to `path`. */
export const written = (w: World, path = MODEL_PATH): BehaviourModel => {
  const last = [...w.writes].reverse().find(x => x.path === path)
  if (!last) throw new Error(`nothing written to ${path}`)
  return JSON.parse(last.text) as BehaviourModel
}

export const paneProps = (columns = 100) => ({
  title: 'how',
  isFocused: true,
  bodyColumns: columns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
})

export const mountPane = ($: any, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'how', surface, component: 'Pane', requestId: 'how', props: paneProps() })

export const callTool = ($: any, tool: 'open' | 'refresh', input: Record<string, unknown>) =>
  $.tool.call({ tool: `mcp__how__${tool}`, ...input }) as Promise<{ result?: unknown; deny?: string; isError?: true; text?: string }>
