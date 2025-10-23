# Floating AI Chat v2 (tailored)

Upgrades:
- Tailored system prompt for your dashboard.
- Short-term memory (last ~12 turns) stored in localStorage and sent to backend.
- Client knobs for temperature and max tokens.
- Simple rate limit (5 req / 10s per IP).
- Streaming responses via SSE.

## Deploy (Vercel)

- Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`) in Vercel environment variables.
- Set the Framework choice to `Other` in Vercel.
- Install Command: `npm install`
- Build Command: `npm run vercel-build` (this currently runs `echo "Nothing to build"` by default)
- Output Directory: `public`

Note: The repository includes an in-browser Python optimizer using Pyodide. To reduce initial page load, Pyodide is loaded only when you click the "Calculate Optimal Distribution (Python)" button in the Decision Optimizer tab.

Local testing:

1. Install dependencies (to make the `serve` helper available):

```powershell
npm install
```

2. Start a simple static server:

```powershell
npm start
# then open http://localhost:3000 in your browser and navigate to /public/index.html
```

Open your site and click the AI button or navigate to Decision Optimizer -> Advanced Python Optimizer to try the Python optimizer.
