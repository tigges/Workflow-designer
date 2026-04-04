# flowcraft v1

## Import model v2 (bounded hierarchical import)

The importer now uses a bounded, hierarchy-aware pipeline to reduce node explosion and improve process quality:

- line cleanup + section detection
- typed step extraction (`process`, `decision`, `fact`, `policy`, `unclassified`)
- hard import budgets (nodes/edges/titles)
- title/notes normalization (`label` kept short, detail in `metadata.notes`)
- structured Gemini proxy output normalized to import text

Reference docs:

- `docs/IMPORT_MODEL_SPEC.md`
- `docs/import-model.schema.json`
- `docs/import-model.example.json`

## Import map document panels (Content Map + Imported Map)

In **Import Map**, both document-map review screens are available:

- **Content Map**
- **Imported Map**

Use the new **Document map review** header controls to show/hide panels while reviewing import quality.

## Gemini proxy setup (secure)

Gemini requests now go through a local server-side proxy route (`/api/gemini/assist`) so API keys are not stored in browser localStorage.

### 1) Configure environment

Copy the example env file and set your key:

```bash
cp .env.example .env
```

Set `GEMINI_API_KEY` in `.env`.

### 2) Run dev

```bash
npm run dev
```

The Vite dev server exposes the proxy route automatically.

### 3) Use in app

In AI Assist:
- choose `External AI: Gemini`
- choose a Gemini mode
- optionally edit model (default `gemini-2.5-flash`)
- click `Use External AI`

Gemini responses are normalized to a structured payload (`import-model-v2`) and then converted into bounded import text for ingestion.
