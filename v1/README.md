# flowcraft v1

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
