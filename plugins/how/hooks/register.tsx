import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { initialNavigation, type ModelState, type Navigation, push } from './panel/navigation'
import { renderPane } from './panel/pane'
import { resolveEvidenceOwner } from './panel/evidence-owner'
import { type Snippets, sliceSnippet, snippetKey } from './panel/evidence-view'

export const PANE_ID = 'how'

// Task 10 writes `model`; the panel writes `nav`.
export const modelState = atom({ plugin: 'how', key: 'model' } as const, {} as ModelState)
export const navState = atom({ plugin: 'how', key: 'nav' } as const, initialNavigation())

export const snippetsState = atom({ plugin: 'how', key: 'snippets' } as const, {} as Snippets)

/**
 * Show the Evidence view for `ownerId`'s `index`th Evidence: read the cited file (relative paths resolve against
 * the session cwd), keep the cited lines ±3 in the `snippets` atom, then push the view. A read failure is stored as
 * `{ error }` and the view still opens ("source unavailable"). From an Evidence view of the same owner (prev/next)
 * the top entry is replaced rather than stacked.
 */
export async function openEvidence($: any, ownerId: string, index: number): Promise<void> {
  const { model } = await read($, modelState)
  const item = model && resolveEvidenceOwner(model, ownerId)?.evidence[index]
  if (item) {
    const key = snippetKey(item)
    let value: Snippets[string]
    try {
      value = sliceSnippet(String(await $.fs.read(item.file)), item.startLine, item.endLine)
    } catch (err) {
      value = { error: err instanceof Error ? err.message : String(err) }
    }
    await update($, snippetsState, (s: Snippets) => ({ ...s, [key]: value }))
  }
  await update($, navState, (nv: Navigation) => {
    const top = nv.stack[nv.stack.length - 1]
    const next = push(nv, { kind: 'evidence', ownerId, index })
    return top?.kind === 'evidence' && top.ownerId === ownerId
      ? { ...next, stack: [...nv.stack.slice(0, -1), next.stack[next.stack.length - 1]!] }
      : next
  })
}

/**
 * Reload the Behaviour model from its path. STUB: Task 10 implements it (the `reload` Button of the error state
 * calls it); until then it deliberately does nothing and loads nothing. Lives here because the engine follows `$`
 * only into functions of the same file, never across an import.
 */
export async function requestReload(_$: unknown): Promise<void> {}

/**
 * Build a pending or failed Behaviour or Seam view. STUB: Task 10 implements it (the `build` and `retry` Buttons
 * call it); until then it deliberately does nothing. Lives here for the same reason as requestReload.
 */
export async function requestBuild(
  _$: unknown,
  _subject: { kind: 'behaviour'; behaviourId: string } | { kind: 'seam'; subjectId: string; behaviourId: string },
): Promise<void> {}

export const register: Register = on => {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    // `$` never leaves this file: the panel layer gets plain data and closures.
    let cwd: string | undefined
    try {
      cwd = await $.session.cwd()
    } catch {
      cwd = undefined // no editor link without an absolute path
    }
    const env = {
      ui: $.ui.resolve(e),
      state: await read($, modelState),
      nav: await read($, navState),
      updateNav: (fn: (n: Navigation) => Navigation) => update($, navState, fn),
      reload: () => requestReload($),
      snippets: await read($, snippetsState),
      cwd,
      openEvidence: (ownerId: string, index: number) => openEvidence($, ownerId, index),
      requestBuild: (subject: Parameters<typeof requestBuild>[1]) => requestBuild($, subject),
    }
    return renderPane(env, e)
  })
}
