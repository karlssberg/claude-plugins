# The drill-down explorer lives in a Claude Code mod panel

The research pointed to a self-contained HTML page or Artifact for interactive drill-down (Mermaid with click handlers, ELK in a browser). We chose a Claude Code mod panel instead. It keeps review inside the loop the developer is already in, with no file to open and no account or publish step. Panel clicks can also reach back into the session, spawning agents to build deeper levels lazily, which a static page cannot do.

## Consequences

- There is no DOM, so Mermaid is out. Diagrams are laid out in the hooks module, using bundled elkjs plus our own sequence layout, and emitted as SVG strings.
- `Svg` is a leaf with no per-node clicks. Nodes become clickable through absolutely positioned Buttons laid over our own layout coordinates, falling back to a clickable legend if that proves unreliable.
- The terminal has no `Svg`, so it gets a text/box fallback. The desktop app and VS Code are the primary surfaces.
- "Open in editor" links work reliably only on the terminal, so code evidence is shown inline in the panel.
- The mod API is early access and changes between releases.
