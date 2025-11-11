// api/agent.js
// Tailored system prompt + short-term memory + simple rate limit + streaming
// Env: OPENAI_API_KEY, optional OPENAI_MODEL (default gpt-4o)

const RATE_WINDOW_MS = 10_000; // 10s
const RATE_MAX = 5; // max 5 requests / 10s per IP
const hits = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  arr.push(now); hits.set(ip, arr);

  let body;
  try { body = req.body || {}; } catch { body = {}; }
  const { message, history = [], temperature = 0.7, max_tokens = 800 } = body;

  if (!message) return res.status(400).json({ error: 'Missing message' });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured: OPENAI_API_KEY not set' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Guardrails / system context — tune to your portal
  const system = [
//    "You are an in-page assistant for a data/ERP dashboard.",
//    "Be concise, actionable, and cite steps if giving instructions.",
//    "When asked about the page, infer from visible sections (tables, cards, filters).",
//    "If the user asks for confidential data or to perform risky actions, refuse and offer safer alternatives.",
//    "Prefer numbered steps; keep responses < 250 words unless explicitly asked for more.",
//    "If math is needed, compute carefully.",
    "You are an in-page assistant for the Gartner Contract Evaluation dashboard shown in index.html.",
    "Ground every answer in the on-screen content: hero summary, KPI cards (Total Cost, Total Users Covered, Avg Cost / User, Budget Utilization, Uncovered Users), negotiation tips, saved-scenarios panel, organization inputs, and usage breakdowns.",
    "Whenever users ask about people, accounts, or trends, infer from the scenario defaults and dashboard metrics and explicitly explain what each KPI value represents for the organization (e.g., how Total Cost reflects the license mix, why Uncovered Users matters).",
    "Summaries should connect metrics to their practical meaning for procurement/renewal discussions and call out notable changes or trade-offs visible in the cards or tables.",
    "Be concise, actionable, and cite steps if giving instructions while remaining within 250 words unless the user asks for more detail.",
    "If the user requests confidential data or risky actions, refuse and suggest safer guidance.",
// "if unsure about something specific to the dashboard, suggest relevant help articles or documentation, and display: \"Info from web, not dashboard.\"",
    "If the answer can be derived from the dashboard, respond using only dashboard data without any source label.",
    "If the answer cannot be derived from the dashboard, first try to retrieve relevant information from connected APIs or trusted web sources and display: 'Info from API/web, not dashboard.' before presenting the information.",
    "If no live API/web data is available and the answer comes from general knowledge, display: 'Info from general knowledge, not dashboard.' before presenting the information.",    
// "If the question cannot be answered using the dashboard data, retrieve relevant information from trusted web sources. Always display: 'Info from web, not dashboard.' before presenting any web-sourced content. If no trustworthy information is available, explain that the data could not be found.",
//    "Keep answers relevant to the dashboard context, tables or cards and avoid generic responses.",
    "User Usage Information: Ace Tan, Procurement Lead at Contoso Ltd, focusing on software license renewals and cost optimization, 1749 documents processed, 25 queries this month, 47 calls, 91 monthly average, 4.6/5 satisfaction rating; Dom Chan, IT Manager at Contoso Ltd, 559 documents processed, 15 queries this month, 31 calls, 30 monthly average, 4.3/5 satisfaction rating;Yz Feng , CFO at Contoso Ltd, 300 documents processed, 5 queries this month, 22 calls, 15 monthly average, 4.0/5 satisfaction rating;Chan Vivian, Operations Head at Contoso Ltd, 261 documents processed, 20 queries this month, 0 calls, 13 monthly average, 4.5/5 satisfaction rating;Wang JH, Data Analytics Lead at Contoso Ltd, 209 documents processed, 8 queries this month, 13 calls, 11 monthly average, 4.2/5 satisfaction rating.",
    "Dashboard reference data: Licensed Users 38, Active Utilization Rate 68%, Cost per Download $632, User Satisfaction 4.1/5; contract coverage shows 20 of 36 months with data, 16 months remaining, projected final spend $3.12M.",
    "Scenario optimizer defaults: headcount 100, budget $500K, departments = Executive 5, Data Analytics 15, IT 20, Operations 30, General 30; usage profile = Heavy 10, Medium 30, Light 60, Conference 15.",
    "Baseline optimization output: Total Cost $1.71M, Total Users Covered 15, Avg Cost/User $114K, Budget Utilization 342%, Uncovered Users 85; Executive seats 5 at $176K each, CDAO seats 10 at $83K each, SMB seats 0 given the budget gap.",
    "KPI meanings: Total Cost sums contract spend for the license mix; Total Users Covered counts funded seats; Avg Cost/User divides spend by covered users; Budget Utilization compares spend against the $500K budget; Uncovered Users are headcount still without access.",
    "When users ask about people, cost, usage, or trends, quote the specific numbers above or updated scenario results and explain what the values imply for the organization (e.g., why utilization is 68%, how the $3.12M projection compares to budget, what drives Uncovered Users).",
    "Summaries must tie metrics to procurement decisions, highlight risks/opportunities, and call out notable changes or trade-offs visible in the cards or tables.",    
    "Users may ask you to help them analyze data, generate reports, or understand key metrics, refer to the information presented on the page."
  ].join(" ");

  // Build messages with recent history
  const msgs = [{ role: 'system', content: system }];
  for (const m of history) {
    if (!m || typeof m.content !== 'string' || (m.role !== 'user' && m.role !== 'assistant')) continue;
    msgs.push({ role: m.role, content: m.content.slice(0, 4000) }); // trim to stay safe
  }
  msgs.push({ role: 'user', content: message });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature,
        max_tokens,
        messages: msgs
      })
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      res.write(`data: ${JSON.stringify({ error: text })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('data:')) {
          const payload = line.replace(/^data:\s*/, '');
          if (payload === '[DONE]') {
            res.write(`data: [DONE]\n\n`);
            res.end();
            return;
          }
          try {
            const json = JSON.parse(payload);
            const token = json.choices?.[0]?.delta?.content || '';
            if (token) res.write(`data: ${JSON.stringify({ delta: token })}\n\n`);
          } catch {}
        }
      }
      buffer = lines[lines.length - 1];
    }
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}
