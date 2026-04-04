# React v1 Phase DoD Checklist

Status legend:

- `[ ]` not started
- `[~]` in progress
- `[x]` done

---

## Phase 1 — React shell

- [x] Vite + React + TypeScript app runs
- [x] Base layout renders (top bar, left panel, canvas area, right panel)
- [x] Routing/state boot without console errors
- [x] Build command succeeds (`npm run build`)

Manual test notes for reviewer:

1. Run `npm install` (if needed) and `npm run dev` in `/workspace/v1`.
2. Verify UI shell sections are visible:
   - top bar
   - left sidebar
   - center canvas placeholder
   - right inspector
3. Verify no obvious console/runtime errors.

---

## Phase 2 — Canonical model + store

- [x] Core types implemented from spec v1.1
- [x] State store supports CRUD for model entities
- [x] Local persistence works (reload restores state)
- [x] Schema version (`1.1`) included in saved artifact

## Phase 3 — Workspace/project/artifact basics

- [x] Can create/select/delete project
- [x] Can create/select artifact and new version
- [x] Folder grouping works (basic)
- [x] Version list shows current + history entries

## Phase 4 — Journey Flow editor

- [x] Add/move/delete/connect nodes
- [x] Edge types supported (seq/cond/parallel/fallback)
- [x] Inspector edits node/edge fields
- [x] Undo works for key actions
- [x] No blocking UI lag at target map size

## Phase 5 — Journey Map projection

- [x] Journey Map tab renders phase/touchpoint view
- [x] Same node IDs used in flow and map
- [x] Shared fields sync both tabs
- [x] Layout metadata isolated per projection
- [x] No data drift between tabs after edits

## Phase 6 — Import modes (incl. doc import adapter)

- [x] Manual mode usable end-to-end
- [x] Text import produces candidate model
- [x] Existing intelligent doc import integrated via adapter
- [x] AI adapter output normalized to canonical model
- [x] Import failures show user-safe errors

## Phase 7 — Validation + review lifecycle

- [x] Validation rules execute and surface issues
- [x] Review states transition: draft -> in_review -> approved/rejected
- [x] Review actions are auditable
- [x] Low-confidence candidates cannot bypass review policy

## Phase 8 — Export contracts

- [x] JSON export/import roundtrip is lossless
- [x] Mermaid export preserves structure
- [x] SVG export renders usable visual output
- [x] PNG export snapshot works
- [x] Export metadata tracked per artifact/version

## Phase 9 — Security + observability baseline

- [ ] Key handling policy implemented (server-first / safe client fallback)
- [ ] No secret leakage in logs/UI/exports
- [ ] Basic metrics available (import, validation, approval, export)
- [ ] Traceability present for import -> review path

## Phase 10 — QA + launch gate

- [ ] Pass/warn/fail QA matrix completed
- [ ] All launch-blocking fails resolved
- [ ] Cross-view consistency verified
- [ ] Export fidelity verified on sample set
- [ ] Release candidate approved for first external testing
