# Marherdr — Herdr layout

A dark Herdr layout with a four-icon activity rail on the right: **Agent Management**,
**Git Graph**, **Code Snippets**, **Ports & Processes**. Everything else lives in the
left sidebar and a single hidden-by-default panel stack.

![Marherdr](marherdr/preview.jpg)

## Install

```sh
APP=~/.config/herdr-app          # or $HERDR_APP_HOME

# layout
cp marherdr/layouts/marherdr.json  "$APP/layouts/"

# themes
cp marherdr/themes/cukup-*.json    "$APP/themes/"

# mods (skip any you already have and want to keep)
cp -R marherdr/mods/*              "$APP/mods/"

# show it
herdr-app do layout.switch --name marherdr
```

`herdr-app check mods/activity-bar` should say `check passed`. `ctrl-shift-l` cycles
layouts; `ctrl-alt-shift-escape` always falls back to `main`.

### Or: previewed-only

Copy `marherdr/mods/activity-bar/` alone if you already have the other mods — it is
the piece that decides which four icons the rail shows.

## What is in here

| Path | Contents |
|---|---|
| `marherdr/layouts/marherdr.json` | the window: sidebar, work column, panel stack, 44 px activity rail |
| `marherdr/mods/` | 20 mods the layout references, `place: none` |
| `marherdr/themes/` | `cukup-malam` (dark), `cukup-terang` (light), `cukup-kopi`, `cukup-senja` |
| `marherdr/RECIPE.md` | the build brief: regions, behaviour, node tree, pitfalls |

## Panel stack

`panel-body` holds twelve blocks in a stack, `hidden: true` at first. Only these four
are reachable from the rail; the rest open via the command palette or a keybind:

| Block id | Mod | On the rail |
|---|---|---|
| `agents` | `agent-manager` | yes |
| `graph` | `git` | yes |
| `snippets` | `snippets` | yes |
| `ports` | `ports` | yes |
| `files` | `filetree` | no |
| `ci` | `ci-dash` | no |
| `pr-flow` | `pr-flow` | no |
| `branch-pr` | `branch-pr` | no |
| `branch-issue` | `branch-issue` | no |
| `todo` | `todo` | no |
| `factory` | `factory` | no |
| `docker` | `docker` | no |

To put another one on the rail, add an entry to `items` in
`mods/activity-bar/main.js`. `togglePanel` does nothing for an id that has no block
in `panel-body`.

## Known limits

- **Three helper binaries are not included.** `branch-pr`, `branch-issue` and
  `factory` ship a prebuilt Rust helper (`bin/herdr-pr`, `bin/herdr-linear`,
  `bin/factory`) that was `arm64` macOS only. Those panels render, but their reads
  fail until you build the helper for your platform. Nothing else depends on them.
- **`gpui-kit.d.ts` is stripped from each mod.** Herdr rewrites it on start to match
  the running version; shipping a stale copy is worse than shipping none.
- **Fonts are not bundled.** The layout asks for `CommitMono Nerd Font` (terminals)
  and `Uncut Sans` (UI). Missing fonts fall back to Herdr's defaults; nothing breaks.
- **`better-sidebar` starts ungrouped.** Its space-parent map lives in `shared.json`
  and is personal, so a fresh install looks flatter than `preview.jpg`.

## Credits

The mods here are Herdr's own shipped mods, copied from a running install. The
layout itself is the arrangement. Shipped under the same terms Herdr ships them
(`LICENSE`, `THIRD-PARTY-NOTICES` in the app bundle; per-mod icon licences sit in
each `icons/` folder).
