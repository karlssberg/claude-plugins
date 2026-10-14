// Path containment for cited files. Pure: Evidence `file` is model data and must never reach outside the repository.

/** Normalises "." and ".." segments; undefined when a ".." climbs above the start. */
function normalise(path: string): string | undefined {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.pop() === undefined) return undefined
    } else out.push(seg)
  }
  return out.join('/')
}

/**
 * The cwd-relative, normalised form of `file`, or undefined when it is not inside `cwd`.
 * A relative path must not escape; an absolute path is accepted only under `cwd` (so never without one).
 */
export function containedPath(file: string, cwd: string | undefined): string | undefined {
  let rel = file
  if (file.startsWith('/')) {
    const root = cwd === undefined ? undefined : normalise(cwd)
    const abs = normalise(file)
    if (root === undefined || abs === undefined || !cwd?.startsWith('/')) return undefined
    if (root !== '' && abs !== root && !abs.startsWith(`${root}/`)) return undefined
    rel = abs.slice(root.length)
  }
  const n = normalise(rel)
  return n === undefined || n === '' ? undefined : n
}
