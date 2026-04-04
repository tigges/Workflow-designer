# Workflow Designer MVP

A lightweight browser-based MVP for business process workflow design, mapping, visualization, and editing.

## Specifications

- [Intelligent Automated Document Import and Journey Flow Conversion Spec](./INTELLIGENT_IMPORT_FLOW_SPEC.md)
  - Includes v1.1 updates: workspace/artifact model, map-vs-flow projection strategy, import modes, key handling policy, export contracts, and launch QA gates.

## Draft UX Prototype (Import + Journey Map + Review)

For quick UX-only walkthrough (static HTML, no backend), open:

- `./draft/import.html`
- `./draft/journey-map.html`
- `./draft/review.html`

This implementation is inspired by your FlowCraft concept and includes:

- Drag-and-drop node palette (process, decision, terminal, data/system, annotation)
- Interactive canvas with grid, node dragging, and minimap
- Port-based connection building with multiple edge types:
  - sequential
  - conditional
  - parallel
  - fallback/error
- Right-side properties editor for nodes and connections
- Validation panel with structural checks
- Undo support
- Built-in templates:
  - Support
  - Onboarding
  - Sales
- JSON import/export
- SVG export
- AI-assisted flow generation panel:
  - Local fallback generator works out of the box
  - Optional remote AI endpoint support via `window.WORKFLOW_AI_ENDPOINT`

---

## Run locally

Because this is a static app, you can run it with any simple static server.

### Option A: Python

```bash
cd /workspace
python3 -m http.server 8080
```

Open:

`http://localhost:8080`

### Option B: Any static host

Upload these files to your host/web root:

- `index.html`
- `styles.css`
- `app.js`

---

## Optional AI endpoint integration

By default, the AI panel uses a local deterministic generator (no key needed).

If you want to connect it to your own backend endpoint, define in your page before `app.js`:

```html
<script>
  window.WORKFLOW_AI_ENDPOINT = "https://your-api.example.com/generate-workflow";
  window.WORKFLOW_AI_KEY = "optional-bearer-token";
</script>
<script src="./app.js"></script>
```

The endpoint should return JSON in this shape:

```json
{
  "title": "Flow title",
  "nodes": [
    {
      "id": "n1",
      "type": "terminal|process|decision|data|annotation",
      "label": "Step label",
      "actor": "customer|agent|system|manager|external|",
      "x": 100,
      "y": 100
    }
  ],
  "connections": [
    {
      "from": "n1",
      "to": "n2",
      "type": "sequential|conditional|parallel|fallback",
      "label": "optional"
    }
  ]
}
```
