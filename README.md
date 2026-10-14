# claude-plugins

Claude Code plugins, skills and mods by karlssberg, published as a plugin marketplace.

## Install

```
/plugin marketplace add karlssberg/claude-plugins
/plugin install <plugin-name>@karlssberg
```

## Plugins

| Plugin | Install | What it does |
|---|---|---|
| [how](plugins/how/README.md) | `/plugin install how@karlssberg` | Explains the Behaviours, Seams and error flows of a PR or codebase as diagrams |

## Layout

```
.claude-plugin/marketplace.json   # marketplace catalogue — list every plugin here
plugins/<name>/                   # one folder per plugin
  .claude-plugin/plugin.json
  skills/<skill>/SKILL.md
  commands/*.md
  agents/*.md
  hooks/hooks.json
templates/example-plugin/         # copy to start a new plugin
```

## Adding a plugin

1. `cp -r templates/example-plugin plugins/<name>` and rename it in `plugin.json`.
2. Add an entry to `.claude-plugin/marketplace.json`:
   ```json
   { "name": "<name>", "source": "./plugins/<name>", "description": "..." }
   ```
3. Validate: `claude plugin validate .`
4. Test locally: `/plugin marketplace add ./` from this folder.
