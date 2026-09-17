# TabVault decision log

## 2026-09-17 — Design

- Request: a tab manager like Tab Manager v2 (https://github.com/xcv58/Tab-Manager-v2)
  with export of all windows and tabs with full details.
- Decisions: build our own in plain JS rather than fork (no React/MobX
  toolchain); JSON export only for v1; restore from JSON with lazy-loaded
  tabs; full-page UI in its own tab; features: all windows/tabs view with
  search, bulk move/close, native tab groups, duplicate cleanup; automatic
  snapshots taken on change (debounced), not on a timer.
- Spec: `docs/superpowers/specs/2026-09-17-tabvault-design.md`.
