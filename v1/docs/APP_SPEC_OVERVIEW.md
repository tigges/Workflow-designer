# Flowcraft App Spec (As-Is)

Status: Active  
Scope: Full application behavior currently implemented in `v1`

## Brief description

Flowcraft is a process-mapping application with a canonical graph model, interactive flow editor, import-to-map workflow, document map review, external AI assist routing, and multi-format export. It is designed to preserve a stable data model while allowing iterative import intelligence upgrades.

## What this spec covers

- Core canonical data model (`nodes`, `edges`, `projections`, `validation`, `confidence`)
- Authoring UX (canvas, inspector, manual edges/nodes)
- Import UX (stages, TOC seeding, detail ingestion, review flow)
- Import Map and Process Map projections
- Document map ingestion/review (Content Map + Imported Map)
- External assist integration (Gemini via backend proxy, OCR cleanup, Copilot fallback path)
- Export and validation workflows

## System overview (visual)

```mermaid
flowchart LR
  U[User] --> UI[React App]
  UI --> S[Zustand Store]
  S --> M[Canonical Model]
  UI --> RF[ReactFlow Canvas]
  UI --> IM[Import Map View]
  UI --> DM[Document Map Panels]
  UI --> GP[/api/gemini/assist Proxy]
  GP --> G[Gemini API]
  UI --> EX[Export JSON/Mermaid/SVG/PNG]
  M --> EX
```

## Key modules (at a glance)

- `src/types.ts` - canonical types and projection contracts
- `src/store.ts` - state + import/content/layout engines
- `src/App.tsx` - primary UI shell and interaction orchestration
- `src/evals.ts` - import fixture + quality metric definitions
- `vite.config.ts` - Gemini backend proxy middleware

