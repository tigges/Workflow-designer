# FlowMap Lite v1 Product Specification

Version: v1.0  
Status: Draft (discussion/baseline)  
Scope: Process Map + User Journey only

---

## 1) Product Summary

### Goal
Build a simple, high-utility visual mapping tool that converts raw process/journey documentation into clear, editable maps with:

1. Manual editor (core canvas operations)
2. Intelligent document import (human-reviewable)
3. User journey flow mapping
4. Intelligent layout optimizer

### Primary intents (v1 only)
- Process Map
- User Journey Flow

### Key product decision
Use **same project, separate canvases/views** by default:
- Journey View (stage-based)
- Process View (graph-based)

Allow cross-links between nodes across views.

---

## 2) Scope

### In Scope
- Intent-first new map flow
- Manual editor for nodes/connectors
- Journey-specific structures (persona, stages, pain points, opportunities)
- Intelligent import wizard with mapping review
- Layout optimization (whole map or selection)
- PNG/PDF export

### Out of Scope (v1)
- Real-time multiplayer
- Deep third-party bidirectional sync
- Large template marketplace
- Full BPMN parity

---

## 3) Information Architecture

```text
Project
├── Canvas: Process View
│   ├── Nodes/Edges
│   └── Layout Profile: Process
├── Canvas: Journey View
│   ├── Stages + Journey Nodes
│   └── Layout Profile: Journey
└── CrossLinks
    ├── JourneyNode -> ProcessNode
    └── ProcessNode -> JourneyNode
```

---

## 4) End-to-End User Flows

### Flow A: Import document -> clean process map -> export

```text
[HOME]
  -> [NEW MAP: Intent=Process, Start=Import]
  -> [IMPORT STEP 1: Source]
  -> [IMPORT STEP 2: Mapping Review + Confidence]
  -> [IMPORT STEP 3: Preview]
  -> [EDITOR: Manual edits]
  -> [OPTIMIZER: Preview/Apply]
  -> [EXPORT: PNG/PDF]
```

### Flow B: Blank user journey -> optimize -> export

```text
[HOME]
  -> [NEW MAP: Intent=Journey, Start=Blank]
  -> [EDITOR: Persona + Stages + Actions + Touchpoints]
  -> [QUALITY CHECK]
  -> [OPTIMIZER]
  -> [EXPORT]
```

---

## 5) Visual ASCII Wireframes

### 5.1 Home / Dashboard

```text
+--------------------------------------------------------------------------------------------------+
| FlowMap Lite                                             [Search........] [New Map +] [Profile] |
+--------------------------------------------------------------------------------------------------+
| CREATE NEW                                                                                       |
| +--------------------------+ +---------------------------+ +----------------------------------+  |
| | Process Map              | | User Journey Flow         | | Import Document                  |  |
| | [Start]                  | | [Start]                   | | [Import]                         |  |
| +--------------------------+ +---------------------------+ +----------------------------------+  |
| RECENT MAPS                                                                                        |
| [Checkout Flow] [Onboarding Journey] [Incident Process]                                          |
+--------------------------------------------------------------------------------------------------+
```

### 5.2 New Map Modal

```text
                       +--------------------------------------------------+
                       | Create New Map                                   |
                       +--------------------------------------------------+
                       | Intent                                            |
                       | (o) Process Map   ( ) User Journey Flow          |
                       |                                                  |
                       | Start Mode                                       |
                       | (o) Blank   ( ) Template   ( ) Import Document  |
                       |                                                  |
                       | Name: [_______________________________]          |
                       |                                 [Cancel] [Next]  |
                       +--------------------------------------------------+
```

### 5.3 Import Wizard

```text
+--------------------------------------------------------------------------------------------------+
| Import Wizard  [1 Source] -- 2 Mapping -- 3 Preview                                             |
+--------------------------------------------------------------------------------------------------+
| Paste text / Upload file                                                                         |
| [ Drop file here (.txt/.md/.docx/.pdf/.csv) ]                                                   |
|                                                                                     [Next]       |
+--------------------------------------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------------------------------------+
| Import Wizard  1 Source -- [2 Mapping] -- 3 Preview                                             |
+--------------------------------------------------------------------------------------------------+
| Extracted Outline                              | Mapping Controls                                |
| 1. Step A                                      | Intent: Process Map (92%)                       |
| 2. Step B                                      | Sequence field: inferred_number                 |
| 3. Decision C                                  | Warnings: 2 ambiguous transitions               |
|                                                |                                                  |
| [Back]                                                                          [Next]          |
+--------------------------------------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------------------------------------+
| Import Wizard  1 Source -- 2 Mapping -- [3 Preview]                                             |
+--------------------------------------------------------------------------------------------------+
| Summary: 18 nodes | 21 connectors | 2 warnings                                                  |
| [Mini Graph Preview]                                                                               |
| [Back to Mapping]                                                  [Generate Editable Map]       |
+--------------------------------------------------------------------------------------------------+
```

### 5.4 Main Editor

```text
+--------------------------------------------------------------------------------------------------+
| Title [Process Map] [Import] [Optimize] [Undo] [Redo] [Export]                                 |
+--------------------------------------------------------------------------------------------------+
| LEFT LIBRARY          | CANVAS                                          | PROPERTIES            |
| [Step] [Decision]     | [Start] -> [Open App] -> <Payment OK?>          | Label: ________       |
| [Connector] [Label]   |                      \-> [Retry]                 | Type: Step            |
|                       |                      \-> [Success]               | Pin position [x]      |
+--------------------------------------------------------------------------------------------------+
```

### 5.5 Journey Editor Variant

```text
+--------------------------------------------------------------------------------------------------+
| Title [User Journey] [Import] [Optimize] [Undo] [Redo] [Export]                                |
+--------------------------------------------------------------------------------------------------+
| Persona: New Buyer                                                                                |
| Stages:   Awareness | Consideration | Signup | Activation                                         |
| Actions:  View ad   | Compare plans | Fill form | Complete setup                                 |
| Touchpts: Instagram | Pricing page  | OTP email | In-app guide                                   |
| Pain:     unclear CTA | choice overload | OTP delay | missing guidance                            |
+--------------------------------------------------------------------------------------------------+
```

### 5.6 Optimizer Modal

```text
                    +------------------------------------------------------+
                    | Intelligent Layout Optimizer                         |
                    +------------------------------------------------------+
                    | Scope: (o) Entire map  ( ) Selection                |
                    | Preserve: [x] Pinned nodes [x] Stage columns        |
                    | Goals:    [x] Min crossings [x] Uniform spacing     |
                    |                       [Cancel] [Preview] [Apply]     |
                    +------------------------------------------------------+
```

---

## 6) Functional Requirements

### 6.1 Manual Editor
- Create/edit/delete nodes and connectors
- Inline text editing
- Drag/drop, pan/zoom
- Multi-select align/distribute
- Undo/redo
- Pin node position

### 6.2 Intent-Specific Modeling

#### Process Map
- Start/End, Step, Decision
- Directed connectors
- Branch labels optional

#### User Journey
- Persona (single persona v1)
- Ordered stages
- Actions per stage
- Touchpoints
- Pain points and opportunities

### 6.3 Intelligent Import
- Inputs: pasted text, txt, md, docx, pdf, csv
- Intent classification + confidence
- Structure extraction and schema mapping
- User mapping review before generation
- Fully editable output

### 6.4 Intelligent Layout Optimizer
- Optimize all or selection
- Process constraints: flow direction, crossing minimization
- Journey constraints: stage-column preservation, row consistency
- Respect pinned nodes
- Preview/apply/revert

### 6.5 Export
- PNG/PDF
- Full map or viewport

---

## 7) Data Model (v1)

```ts
type Project = { id: string; name: string; createdAt: string; updatedAt: string };
type Canvas = {
  id: string;
  projectId: string;
  intent: "process" | "journey";
  name: string;
  createdAt: string;
  updatedAt: string;
};
type Node = {
  id: string;
  canvasId: string;
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pinned?: boolean;
  metadata?: Record<string, string>;
};
type Edge = { id: string; canvasId: string; sourceId: string; targetId: string; label?: string };
type Stage = { id: string; canvasId: string; name: string; order: number };
type CrossLink = {
  id: string;
  projectId: string;
  fromCanvasId: string;
  fromNodeId: string;
  toCanvasId: string;
  toNodeId: string;
};
type ImportRun = {
  id: string;
  projectId: string;
  sourceType: string;
  detectedIntent: "process" | "journey";
  confidence: number;
  warnings: string[];
};
```

---

## 8) Ticket Breakdown (Frontend / Backend / AI-Parser)

### Frontend
- FE-01: Intent-first New Map flow
- FE-02: Core canvas editor
- FE-03: Intent-aware palettes + journey lane UI
- FE-04: Properties panel + pinning
- FE-05: Import wizard UI (3 steps)
- FE-06: Optimizer modal with preview/apply/revert
- FE-07: Same project, dual-view navigation + cross-link jump
- FE-08: Export modal

### Backend
- BE-01: Core model + CRUD APIs
- BE-02: Revision/snapshot support
- BE-03: Layout service v1 (process/journey policies)
- BE-04: Import orchestration API (async jobs + status)
- BE-05: Export render service
- BE-06: Telemetry/event API

### AI / Parser
- AI-01: Canonical output schema contract
- AI-02: Intent classifier
- AI-03: Process extractor
- AI-04: Journey extractor
- AI-05: Confidence + warnings + mapping hints
- AI-06: Evaluation harness and regression set
- AI-07: Token/latency guardrails (chunking, truncation, fallback)

---

## 9) Two-Sprint Implementation Plan (Dependency Ordered)

## Sprint 1: Foundations + Manual Editor + Optimizer/Export

| Step | Tickets | Depends On | Deliverable | Effort (hrs) | Token Usage |
|---|---|---|---|---:|---:|
| 1 | BE-01 | — | Project/canvas graph APIs | 20 | 0 |
| 2 | FE-01 | Step 1 | Intent-first create flow | 10 | 0 |
| 3 | FE-02 | Step 1 | Manual editor baseline | 36 | 0 |
| 4 | FE-03, FE-04 | Step 3 | Journey lanes + properties | 24 | 0 |
| 5 | BE-03, FE-06 | Steps 3-4 | Optimizer preview/apply/revert | 28 | 0 |
| 6 | BE-05, FE-08 | Step 3 | Export PNG/PDF | 16 | 0 |
| 7 | AI-01 | — | Unified parser schema contract | 10 | ~60k build/eval |
| 8 | BE-02 | Steps 3,5 | Revisions and rollback safety | 14 | 0 |

Sprint 1 subtotal: **158 hrs**, **~60k build/eval tokens**

## Sprint 2: Intelligent Import + Dual-View Linking + AI Quality

| Step | Tickets | Depends On | Deliverable | Effort (hrs) | Token Usage |
|---|---|---|---|---:|---:|
| 9 | BE-04 | Step 1, AI-01 | Async import orchestration | 22 | 0 |
| 10 | AI-02 | AI-01 | Intent detection with confidence | 10 | ~80k build / ~600 runtime |
| 11 | AI-03 | AI-01,10 | Process extraction JSON | 24 | ~220k build / 3k-10k runtime |
| 12 | AI-04 | AI-01,10 | Journey extraction JSON | 24 | ~240k build / 4k-12k runtime |
| 13 | AI-05, FE-05 | Steps 9,11,12 | Mapping review + warning UX | 26 | ~120k build / ~800 runtime |
| 14 | FE-07 (+API) | Steps 1,3,4 | Dual-view navigation + cross-links | 20 | 0 |
| 15 | AI-06 | Steps 11-13 | Eval harness + regression checks | 16 | ~180k build/eval |
| 16 | AI-07, BE-06 | Steps 9-15 | Token caps + telemetry + fallback | 18 | ~40k build / runtime reduction |

Sprint 2 subtotal: **160 hrs**, **~880k build/eval tokens**

Typical runtime per import after guardrails: **~8k-23k tokens**.

---

## 10) Dependency Graph (Critical Path)

```text
BE-01 -> FE-01 -> FE-02 -> FE-03/04 -> BE-03+FE-06 -> BE-02
   \\                                  \\            \\
    \\                                  -> BE-05+FE-08
     -> AI-01 -> BE-04 -> AI-02 -> AI-03/04 -> AI-05+FE-05 -> AI-06 -> AI-07
                                            \\                             /
                                             -------> FE-07 (+API) --------
```

---

## 11) Risk Notes and Mitigations

1. **Import quality variance (PDF/DOCX complexity)**
   - Mitigation: normalization + OCR fallback + mandatory mapping review.

2. **Token/cost variance on long docs**
   - Mitigation: chunking and staged extraction with hard caps.

3. **Layout disrupts manual intent**
   - Mitigation: pinning + selection-only optimize + preview/revert.

4. **Journey/process semantic mixing**
   - Mitigation: separate canvases by default, cross-link instead of merge.

5. **Hallucinated parser edges**
   - Mitigation: confidence surfacing + explicit unresolved/ambiguous queue.

6. **Undo complexity across import + optimization**
   - Mitigation: revision snapshots per destructive action.

7. **Latency spikes**
   - Mitigation: async job pipeline + progressive status feedback.

8. **Regression drift in prompts/models**
   - Mitigation: golden-set evaluations gated in CI.

---

## 12) Suggested Runtime Token Policy

- Soft cap/import: 12k tokens
- Hard cap/import: 20k tokens
- If over cap: auto-switch to staged extraction (outline -> drilldown)
- Monitor:
  - tokens/import
  - import confidence
  - manual correction volume
  - latency per stage

---

## 13) Acceptance Criteria (MVP)

1. User can create and edit both intent types from blank.
2. User can import supported documents, review mappings, and generate editable maps.
3. Layout optimizer can preview/apply and revert changes safely.
4. User can keep Journey and Process in one project as separate canvases and cross-link nodes.
5. User can export map in PNG/PDF.

---

## 14) Download Notes

This file is self-contained and can be downloaded directly as:

`FLOWMAP_LITE_V1_SPEC.md`

For distribution as PDF, render this Markdown via any markdown-to-PDF tool.

