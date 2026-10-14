// Evidence view: the exact code (and PR diff hunk) behind a node or edge, inline in the panel.
import { containedPath } from '../model/paths'
import type { BehaviourModel } from '../model/behaviour-model'
import { resolveEvidenceOwner } from './evidence-owner'
import type { ViewRef } from './navigation'
import type { PaneEnv } from './pane'
import { truncate, wrap } from './text'

/** A loaded snippet (the cited lines +-3; `more` lines were cut past MAX_LINES), or why there is none. */
export type Snippet = { source: string; startLine: number; more?: number } | { error: string }
export type Snippets = Record<string, Snippet>

/** Lines of context kept either side of the cited lines. */
export const CONTEXT_LINES = 3
/** A stored snippet holds at most this many lines. */
export const MAX_LINES = 200
/** The snippets atom keeps this many entries, the most recent. */
export const MAX_SNIPPETS = 20
/** Link.href limit. */
export const HREF_MAX = 2048

export const snippetKey = (e: { file: string; startLine: number; endLine: number }) => `${e.file}:${e.startLine}-${e.endLine}`

/** The cited lines +-3 of `text`, capped at MAX_LINES; an error when the lines lie beyond the end of the file. */
export function sliceSnippet(text: string, startLine: number, endLine: number, file: string): Snippet {
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  if (endLine < startLine || startLine > lines.length)
    return { error: `lines ${startLine}-${endLine} are beyond the end of ${file} (${lines.length} lines)` }
  const first = Math.max(1, startLine - CONTEXT_LINES)
  const last = Math.min(lines.length, endLine + CONTEXT_LINES)
  const picked = lines.slice(first - 1, last)
  const kept = picked.slice(0, MAX_LINES)
  return { source: kept.join('\n'), startLine: first, ...(picked.length > kept.length ? { more: picked.length - kept.length } : {}) }
}

/** `cwd` joined with the contained (normalised) relative path of `file`; undefined when it lies outside. */
export function absolutePath(cwd: string, file: string): string | undefined {
  const rel = containedPath(file, cwd)
  return rel === undefined ? undefined : `${cwd.replace(/\/+$/, '')}/${rel}`
}

export function renderEvidenceView(
  env: PaneEnv,
  ref: Extract<ViewRef, { kind: 'evidence' }>,
  model: BehaviourModel,
  snippets: Snippets,
  columns: number,
  surface: string,
) {
  const { Box, Text, Button, Code, Link } = env.ui
  const owner = resolveEvidenceOwner(model, ref.ownerId)
  const item = owner?.evidence[ref.index]
  if (!owner || !item) {
    return (
      <Box key="evidence-missing">
        <Text dimColor>{truncate('Evidence not found in the Behaviour model.', columns)}</Text>
      </Box>
    )
  }
  const count = owner.evidence.length
  const snippet = snippets[snippetKey(item)]
  const lines = item.startLine === item.endLine ? `${item.startLine}` : `${item.startLine}-${item.endLine}`
  const verified = item.status === 'verified'
  const abs = surface === 'terminal' && env.cwd !== undefined ? absolutePath(env.cwd, item.file) : undefined
  const link = abs === undefined ? undefined : `vscode://file/${encodeURI(abs)}:${item.startLine}`
  const href = link !== undefined && link.length <= HREF_MAX ? link : undefined
  const to = (index: number) => () => env.openEvidence(ref.ownerId, index)

  return (
    <Box flexDirection="column">
      <Box key="evidence-heading" flexDirection="column">
        {wrap(owner.label, columns).map((l: string) => (
          <Text bold>{l}</Text>
        ))}
      </Box>
      {count > 1 && (
        <Box key="evidence-pager" flexDirection="row">
          {ref.index > 0 && (
            <Button key="prev-evidence" onPress={to(ref.index - 1)}>
              ‹ prev
            </Button>
          )}
          <Text dimColor>{` ${ref.index + 1} of ${count} `}</Text>
          {ref.index < count - 1 && (
            <Button key="next-evidence" onPress={to(ref.index + 1)}>
              next ›
            </Button>
          )}
        </Box>
      )}
      <Box key="evidence-location" flexDirection="column">
        {wrap(`${item.file}:${lines}  ${item.symbol}`, columns).map((l: string) => (
          <Text dimColor>{l}</Text>
        ))}
      </Box>
      <Box key="evidence-status">
        <Text color={verified ? 'green' : 'yellow'}>{verified ? 'verified' : 'inferred (not proven by the code)'}</Text>
      </Box>
      {snippet === undefined ? (
        <Box key="evidence-code-loading">
          <Text dimColor>Loading source…</Text>
        </Box>
      ) : 'error' in snippet ? (
        <Box key="evidence-code-unavailable" flexDirection="column">
          <Text color="red">source unavailable</Text>
          {wrap(snippet.error, columns).map((l: string) => (
            <Text dimColor>{l}</Text>
          ))}
        </Box>
      ) : (
        <Box key="evidence-code" flexDirection="column">
          <Code path={item.file} startLine={snippet.startLine} source={snippet.source} />
          {snippet.more !== undefined && <Text dimColor>{`… ${snippet.more} more lines`}</Text>}
        </Box>
      )}
      {item.hunk !== undefined && item.hunk !== '' && (
        <Box key="evidence-hunk" flexDirection="column">
          <Text dimColor>Changed in this PR</Text>
          <Code path={item.file} format="diff" source={item.hunk} />
        </Box>
      )}
      {href !== undefined && (
        <Box key="evidence-editor">
          <Link href={href}>Open in editor</Link>
        </Box>
      )}
    </Box>
  )
}
