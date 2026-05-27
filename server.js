const express = require('express');
const { getAvailableSlots, bookAppointment, getAllAppointments, cancelAppointment, getAvailabilitySummary,
        startCallSession, endCallSession, getCallSessions, getCallSession } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS — same-origin only (nginx proxies /api/ so browser sees same origin)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://voicebot.veraxiss.me');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// GET /api/availability?date=2026-04-05
app.get('/api/availability', (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date param required (YYYY-MM-DD)' });
  }
  res.json({ date, slots: getAvailableSlots(date) });
});

// GET /api/availability/summary  — full 14-day text for AI prompt
app.get('/api/availability/summary', (req, res) => {
  res.json({ summary: getAvailabilitySummary() });
});

// GET /api/appointments?from=2026-04-01&to=2026-04-30&demo=true
app.get('/api/appointments', (req, res) => {
  const { from, to, demo } = req.query;
  const rows = getAllAppointments({ from, to, includeDemo: demo === 'true' });
  res.json({ count: rows.length, appointments: rows });
});

// POST /api/appointments
// body: { date, time, name, service, phone }
app.post('/api/appointments', (req, res) => {
  const { date, time, name, service, phone } = req.body;

  if (!date || !time || !name || !service) {
    return res.status(400).json({ error: 'date, time, name, service are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: 'time must be HH:MM' });
  }

  const result = bookAppointment({ date, time, patient: name, service, phone });

  if (!result.ok) {
    return res.status(409).json({ error: 'Slot not available', reason: result.reason });
  }

  res.status(201).json({ ok: true, id: result.id, date, time, name, service, phone });
});

// DELETE /api/appointments/:id
app.delete('/api/appointments/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const ok = cancelAppointment(id);
  if (!ok) return res.status(404).json({ error: 'Appointment not found' });
  res.json({ ok: true });
});

// ── Call session endpoints ──

// POST /api/calls/start
app.post('/api/calls/start', (req, res) => {
  const id = startCallSession();
  res.status(201).json({ ok: true, callId: id });
});

// POST /api/calls/end
// body: { callId, duration_sec, transcript: [{role, text, ts}], appointment_id? }
app.post('/api/calls/end', (req, res) => {
  const { callId, duration_sec, transcript, appointment_id } = req.body;
  if (!callId) return res.status(400).json({ error: 'callId required' });
  const ok = endCallSession({ id: callId, transcript, duration_sec, appointment_id });
  if (!ok) return res.status(404).json({ error: 'Call session not found' });
  res.json({ ok: true });
});

// GET /api/calls?limit=50
app.get('/api/calls', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows  = getCallSessions({ limit });
  const sessions = rows.map(r => ({
    ...r,
    transcript: r.transcript ? JSON.parse(r.transcript) : []
  }));
  res.json({ count: sessions.length, sessions });
});

// GET /api/calls/:id
app.get('/api/calls/:id', (req, res) => {
  const row = getCallSession(parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, transcript: row.transcript ? JSON.parse(row.transcript) : [] });
});

// POST /api/chat  — Groq proxy, key never leaves the server
// body: { model, messages }
app.post('/api/chat', async (req, res) => {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: 'Groq API key not configured on server' });

  const { model, messages } = req.body;
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'model and messages are required' });
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${groqKey}`
      },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 120 })
    });

    const data = await groqRes.json();
    if (!groqRes.ok) return res.status(groqRes.status).json({ error: data?.error?.message || 'Groq error' });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to reach Groq: ' + e.message });
  }
});

app.listen(PORT, () => console.log(`voice-bot-api running on port ${PORT}`));
