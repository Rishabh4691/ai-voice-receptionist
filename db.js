const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'voicebot.db'));

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    time        TEXT NOT NULL,
    patient     TEXT NOT NULL,
    service     TEXT NOT NULL,
    phone       TEXT NOT NULL DEFAULT '',
    booked_at   TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled   INTEGER NOT NULL DEFAULT 0,
    is_demo     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_date ON appointments(date);

  CREATE TABLE IF NOT EXISTS call_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at        TEXT,
    duration_sec    INTEGER,
    transcript      TEXT,
    appointment_id  INTEGER,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Weekly slot template ──
// day-of-week (0=Sun) -> slots
const SCHEDULE = {
  1: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'],
  2: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'],
  3: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'],
  4: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'],
  5: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'],
  6: ['09:00','10:00','11:00','12:00'],
};

// ── Seed pre-booked demo data (only once ever, tracked via meta table) ──
const seedCheck = db.prepare(`SELECT value FROM meta WHERE key = 'seeded'`).get();
if (!seedCheck) {
  const seed = db.prepare(`
    INSERT INTO appointments (date, time, patient, service, phone, is_demo)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  const demos = [
    ['2026-04-01','09:00','Emma Wilson','Routine Checkup & Cleaning','555-0101'],
    ['2026-04-01','11:00','James Carter','Teeth Whitening','555-0102'],
    ['2026-04-01','14:00','Priya Patel','Cavity Filling','555-0103'],
    ['2026-04-01','15:00','Tom Nguyen','Full-Mouth X-Ray','555-0104'],
    ['2026-04-02','10:00','Sarah Kim','Routine Checkup & Cleaning','555-0105'],
    ['2026-04-02','12:00','David Osei','Root Canal Treatment','555-0106'],
    ['2026-04-02','13:00','Lisa Fernandez','Custom Night Guard','555-0107'],
    ['2026-04-03','09:00','Marcus Lee','Tooth Extraction','555-0108'],
    ['2026-04-03','10:00','Anna Müller','Teeth Whitening','555-0109'],
    ['2026-04-03','15:00','Ryan Clark','Cavity Filling','555-0110'],
    ['2026-04-03','16:00','Mei Zhang','Routine Checkup & Cleaning','555-0111'],
    ['2026-04-04','09:00','Jake Thompson','Dental Implants','555-0112'],
    ['2026-04-04','11:00','Aisha Diallo','Orthodontic Consultation','555-0113'],
    ['2026-04-06','11:00','Chris Murphy','Routine Checkup & Cleaning','555-0114'],
    ['2026-04-06','12:00','Fatima Malik','Teeth Whitening','555-0115'],
    ['2026-04-06','14:00','Ben Foster','Cavity Filling','555-0116'],
    ['2026-04-07','09:00','Olivia Brown','Root Canal Treatment','555-0117'],
    ['2026-04-07','10:00','Noah Davis','Routine Checkup & Cleaning','555-0118'],
    ['2026-04-07','13:00','Chloe Martin','Teeth Whitening','555-0119'],
    ['2026-04-07','16:00','Ethan White','Full-Mouth X-Ray','555-0120'],
    ['2026-04-08','10:00','Sofia Reyes','Cavity Filling','555-0121'],
    ['2026-04-08','11:00','Liam Johnson','Dental Implants','555-0122'],
    ['2026-04-08','14:00','Ava Wilson','Routine Checkup & Cleaning','555-0123'],
    ['2026-04-09','09:00','Mason Hall','Emergency Visit','555-0124'],
    ['2026-04-09','12:00','Isabella Young','Teeth Whitening','555-0125'],
    ['2026-04-09','14:00','Lucas Scott','Cavity Filling','555-0126'],
    ['2026-04-09','15:00','Mia Adams','Custom Night Guard','555-0127'],
    ['2026-04-10','10:00','Elijah Baker','Routine Checkup & Cleaning','555-0128'],
    ['2026-04-10','11:00','Harper Nelson','Root Canal Treatment','555-0129'],
    ['2026-04-10','13:00','James Hill','Teeth Whitening','555-0130'],
  ];
  const insertAll = db.transaction(() => {
    demos.forEach(d => seed.run(...d));
    db.prepare(`INSERT INTO meta (key, value) VALUES ('seeded', '1')`).run();
  });
  insertAll();
  console.log(`Seeded ${demos.length} demo appointments.`);
}

// ── Queries ──
function getBookedSlots(date) {
  return db.prepare(`
    SELECT time FROM appointments WHERE date = ? AND cancelled = 0 AND is_demo = 0
  `).all(date).map(r => r.time);
}

function getAvailableSlots(date) {
  const d   = new Date(date + 'T12:00:00');
  const dow = d.getDay();
  const template = SCHEDULE[dow];
  if (!template) return [];
  const booked = getBookedSlots(date);
  return template.filter(t => !booked.includes(t));
}

function bookAppointment({ date, time, patient, service, phone }) {
  const available = getAvailableSlots(date);
  if (!available.includes(time)) return { ok: false, reason: 'slot_taken' };

  const result = db.prepare(`
    INSERT INTO appointments (date, time, patient, service, phone)
    VALUES (?, ?, ?, ?, ?)
  `).run(date, time, patient, service, phone || '');

  return { ok: true, id: result.lastInsertRowid };
}

function getAllAppointments({ from, to, includeDemo } = {}) {
  let sql = `SELECT * FROM appointments WHERE cancelled = 0`;
  const params = [];
  if (from)        { sql += ` AND date >= ?`; params.push(from); }
  if (to)          { sql += ` AND date <= ?`; params.push(to); }
  if (!includeDemo) { sql += ` AND is_demo = 0`; }
  sql += ` ORDER BY date, time`;
  return db.prepare(sql).all(...params);
}

function cancelAppointment(id) {
  const r = db.prepare(`UPDATE appointments SET cancelled = 1 WHERE id = ?`).run(id);
  return r.changes > 0;
}

// Availability summary string for AI prompt (next 14 days)
function getAvailabilitySummary() {
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const today = new Date();
  const lines = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const ds    = d.toISOString().split('T')[0];
    const dow   = d.getDay();
    const slots = getAvailableSlots(ds);
    const name  = dayNames[dow];
    if (!SCHEDULE[dow])    lines.push(`${name} ${ds}: CLOSED`);
    else if (!slots.length) lines.push(`${name} ${ds}: FULLY BOOKED`);
    else                   lines.push(`${name} ${ds}: ${slots.join(', ')}`);
  }
  return lines.join('\n');
}

// ── Call session functions ──
function startCallSession() {
  const r = db.prepare(`INSERT INTO call_sessions (started_at) VALUES (datetime('now'))`).run();
  return r.lastInsertRowid;
}

function endCallSession({ id, transcript, duration_sec, appointment_id }) {
  const r = db.prepare(`
    UPDATE call_sessions
    SET ended_at     = datetime('now'),
        duration_sec = ?,
        transcript   = ?,
        appointment_id = ?
    WHERE id = ?
  `).run(duration_sec || 0, JSON.stringify(transcript || []), appointment_id || null, id);
  return r.changes > 0;
}

function getCallSessions({ limit = 50 } = {}) {
  return db.prepare(`
    SELECT cs.*, a.patient, a.date as appt_date, a.time as appt_time, a.service
    FROM call_sessions cs
    LEFT JOIN appointments a ON a.id = cs.appointment_id
    ORDER BY cs.started_at DESC
    LIMIT ?
  `).all(limit);
}

function getCallSession(id) {
  return db.prepare(`
    SELECT cs.*, a.patient, a.date as appt_date, a.time as appt_time, a.service
    FROM call_sessions cs
    LEFT JOIN appointments a ON a.id = cs.appointment_id
    WHERE cs.id = ?
  `).get(id);
}

module.exports = {
  getAvailableSlots, bookAppointment, getAllAppointments, cancelAppointment, getAvailabilitySummary,
  startCallSession, endCallSession, getCallSessions, getCallSession
};
