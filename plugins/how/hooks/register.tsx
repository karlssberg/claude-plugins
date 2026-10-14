import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { initialNavigation, type ModelState, type Navigation } from './panel/navigation'
import { renderPane } from './panel/pane'

export const PANE_ID = 'how'

// Task 10 writes `model`; the panel writes `nav`.
export const modelState = atom({ plugin: 'how', key: 'model' } as const, {} as ModelState)
export const navState = atom({ plugin: 'how', key: 'nav' } as const, initialNavigation())

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
    const env = {
      ui: $.ui.resolve(e),
      state: await read($, modelState),
      nav: await read($, navState),
      updateNav: (fn: (n: Navigation) => Navigation) => update($, navState, fn),
      reload: () => requestReload($),
      requestBuild: (subject: Parameters<typeof requestBuild>[1]) => requestBuild($, subject),
    }
    return renderPane(env, e)
  })
}
