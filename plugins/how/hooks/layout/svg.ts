// Renders a Layout to a self-contained SVG string: no script, no handlers, no external references.
import type { Layout, LayoutEdge, LayoutNode, NodeStyle } from './geometry'

const esc = (s: string) =>
  s
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip characters XML forbids
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const STYLE = `svg{--fg:#24292f;--bg:#fff;--mute:#8c959f;--add:#1a7f37;--chg:#9a6700;--rem:#6e7781;--err:#cf222e}
@media (prefers-color-scheme: dark){svg{--fg:#e6edf3;--bg:#0d1117;--mute:#7d8590;--add:#3fb950;--chg:#d29922;--rem:#8b949e;--err:#ff7b72}}
text{font-family:ui-monospace,Menlo,monospace;fill:var(--fg)}
.node rect{fill:var(--bg);stroke:var(--fg);stroke-width:1.5}
.life{stroke:var(--mute);stroke-dasharray:2 4}
.edge polyline{fill:none;stroke:var(--fg);stroke-width:1.5}
.arrow{fill:var(--fg)}
.diff-added rect,.diff-added polyline{stroke:var(--add)}.diff-added text{fill:var(--add)}
.diff-changed rect,.diff-changed polyline{stroke:var(--chg)}.diff-changed text{fill:var(--chg)}
.diff-removed rect,.diff-removed polyline{stroke:var(--rem)}.diff-removed text{fill:var(--rem);text-decoration:line-through}
.inferred rect,.inferred polyline{stroke-dasharray:6 3}
.group rect{stroke-width:3}
.faded{opacity:.5}
.error polyline{stroke:var(--err);stroke-dasharray:5 3}.error text{fill:var(--err)}
.seam polyline{stroke-width:2.5}
.badge rect{fill:var(--err);stroke:none}.badge text{fill:var(--bg)}`

function classes(base: string, s: NodeStyle & { isSeamCrossing?: boolean }): string {
  const c = [base, `diff-${s.diff}`]
  if (s.isInferred) c.push('inferred')
  if (s.isGroup) c.push('group')
  if (s.isFaded) c.push('faded')
  if (s.isError) c.push('error')
  if (s.isSwallowed) c.push('swallowed')
  if (s.isSeamCrossing) c.push('seam')
  return c.join(' ')
}

const num = (n: number) => String(Math.round(n * 10) / 10)

export function toSvg(layout: Layout, cell: { width: number; height: number }): string {
  const w = layout.cols * cell.width
  const h = layout.rows * cell.height
  const fs = Math.round(cell.height * 0.7 * 10) / 10
  const px = (c: number) => num(c * cell.width)
  const py = (r: number) => num(r * cell.height)
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}" font-size="${fs}">`,
    `<style>${STYLE}</style>`,
    `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path class="arrow" d="M0 0L8 4L0 8z"/></marker></defs>`,
  ]
  const node = (n: LayoutNode) => {
    const cx = n.rect.col + n.rect.cols / 2
    const top = n.rect.row + n.rect.rows
    return (
      `<g class="${classes('node', n.style)}" data-id="${esc(n.id)}"><title>${esc(n.label)}</title>` +
      `<line class="life" x1="${px(cx)}" y1="${py(top)}" x2="${px(cx)}" y2="${py(layout.rows)}"/>` +
      `<rect x="${px(n.rect.col)}" y="${py(n.rect.row)}" width="${px(n.rect.cols)}" height="${py(n.rect.rows)}" rx="3"/>` +
      `<text x="${px(cx)}" y="${py(n.rect.row + n.rect.rows / 2 + 0.3)}" text-anchor="middle">${esc(n.label)}</text></g>`
    )
  }
  const edge = (e: LayoutEdge) => {
    const pts = e.points
    const first = pts[0]!
    const last = pts[pts.length - 1]!
    const left = Math.min(first.col, last.col, ...pts.map(p => p.col))
    const labelCol = e.from === e.to ? first.col + 4 : left + 1
    const labelRow = e.from === e.to ? first.row + 0.3 : first.row - 0.4
    let g =
      `<g class="${classes('edge', e.style)}" data-id="${esc(e.id)}"><title>${esc(e.label)}</title>` +
      `<polyline points="${pts.map(p => `${px(p.col)},${py(p.row)}`).join(' ')}" marker-end="url(#arrow)"/>` +
      `<text x="${px(labelCol)}" y="${py(labelRow)}">${esc(e.label)}</text>`
    if (e.style.isSwallowed) {
      const bx = (first.col + last.col) / 2 - 3
      const by = first.row + 0.3
      g +=
        `<g class="badge"><rect x="${px(bx)}" y="${py(by)}" width="${px(6)}" height="${py(0.9)}" rx="2"/>` +
        `<text x="${px(bx + 3)}" y="${py(by + 0.7)}" text-anchor="middle" font-size="${num(fs * 0.7)}">swallowed</text></g>`
    }
    return `${g}</g>`
  }
  layout.nodes.forEach(n => out.push(node(n)))
  layout.edges.forEach(e => out.push(edge(e)))
  out.push('</svg>')
  return out.join('')
}
