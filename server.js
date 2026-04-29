const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      date DATE NOT NULL,
      start_time TIME,
      deadline DATE,
      value NUMERIC(10,2),
      signal_value NUMERIC(10,2) DEFAULT 0,
      payment_status TEXT DEFAULT 'pendente',
      notes TEXT,
      location TEXT,
      done BOOLEAN DEFAULT false,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS checklist_items (
      id SERIAL PRIMARY KEY,
      job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      done BOOLEAN DEFAULT false,
      position INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  const migrations = [
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_time TIME`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deadline DATE`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pendente'`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signal_value NUMERIC(10,2) DEFAULT 0`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location TEXT`,
  ];
  for (const sql of migrations) { await pool.query(sql).catch(() => {}); }
  console.log('Banco pronto.');
}

// ── CLIENTS ──────────────────────────────────────────────────
app.get('/api/clients', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM clients ORDER BY name ASC')).rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/clients', async (req, res) => {
  const { name, phone, email } = req.body;
  try { res.json((await pool.query('INSERT INTO clients(name,phone,email) VALUES($1,$2,$3) RETURNING *', [name, phone||null, email||null])).rows[0]); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/clients/:id', async (req, res) => {
  const { name, phone, email } = req.body;
  try { res.json((await pool.query('UPDATE clients SET name=$1,phone=$2,email=$3 WHERE id=$4 RETURNING *', [name, phone||null, email||null, req.params.id])).rows[0]); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/clients/:id', async (req, res) => {
  try { await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/clients/:id/jobs', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM jobs WHERE client_id=$1 ORDER BY date DESC', [req.params.id])).rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── JOBS ──────────────────────────────────────────────────────
app.get('/api/jobs', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT j.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
      FROM jobs j LEFT JOIN clients c ON j.client_id = c.id
      ORDER BY j.date ASC, j.start_time ASC NULLS LAST, j.created_at DESC
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/jobs', async (req, res) => {
  const { title, type, date, start_time, deadline, value, signal_value, payment_status, notes, location, client_id } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO jobs(title,type,date,start_time,deadline,value,signal_value,payment_status,notes,location,client_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [title, type, date, start_time||null, deadline||null, value||null, signal_value||0, payment_status||'pendente', notes||null, location||null, client_id||null]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/jobs/:id', async (req, res) => {
  const { title, type, date, start_time, deadline, value, signal_value, payment_status, notes, location, client_id, done } = req.body;
  try {
    const r = await pool.query(
      `UPDATE jobs SET title=$1,type=$2,date=$3,start_time=$4,deadline=$5,value=$6,signal_value=$7,
       payment_status=$8,notes=$9,location=$10,client_id=$11,done=$12 WHERE id=$13 RETURNING *`,
      [title, type, date, start_time||null, deadline||null, value||null, signal_value||0, payment_status||'pendente', notes||null, location||null, client_id||null, done??false, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/jobs/:id/toggle', async (req, res) => {
  try { res.json((await pool.query('UPDATE jobs SET done=NOT done WHERE id=$1 RETURNING *', [req.params.id])).rows[0]); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/jobs/:id', async (req, res) => {
  try { await pool.query('DELETE FROM jobs WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CHECKLIST ─────────────────────────────────────────────────
app.get('/api/jobs/:id/checklist', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM checklist_items WHERE job_id=$1 ORDER BY position ASC, created_at ASC', [req.params.id])).rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/jobs/:id/checklist', async (req, res) => {
  const { text, position } = req.body;
  try { res.json((await pool.query('INSERT INTO checklist_items(job_id,text,position) VALUES($1,$2,$3) RETURNING *', [req.params.id, text, position||0])).rows[0]); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/checklist/:id/toggle', async (req, res) => {
  try { res.json((await pool.query('UPDATE checklist_items SET done=NOT done WHERE id=$1 RETURNING *', [req.params.id])).rows[0]); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/checklist/:id', async (req, res) => {
  try { await pool.query('DELETE FROM checklist_items WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EMAIL (Resend) ────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return { skipped: true };
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from: 'Minha Agenda <agenda@' + (process.env.EMAIL_DOMAIN||'resend.dev') + '>', to, subject, html });
    const req = https.request({ hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let d=''; res.on('data', c => d+=c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject); req.write(body); req.end();
  });
}

// Envia lembretes para trabalhos de amanhã
app.post('/api/send-reminders', async (req, res) => {
  try {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
    const ds = tomorrow.toISOString().slice(0,10);
    const { rows } = await pool.query(`
      SELECT j.*, c.email AS client_email, c.name AS client_name
      FROM jobs j LEFT JOIN clients c ON j.client_id=c.id
      WHERE j.date=$1 AND j.done=false`, [ds]);
    const myEmail = process.env.MY_EMAIL;
    if (!myEmail) return res.json({ ok: false, reason: 'MY_EMAIL not set' });
    let sent = 0;
    for (const j of rows) {
      const html = `<h2>Lembrete: ${j.title}</h2>
        <p><b>Amanhã</b> — ${ds}${j.start_time ? ' às ' + j.start_time.slice(0,5) : ''}</p>
        ${j.location ? `<p>📍 ${j.location}</p>` : ''}
        ${j.client_name ? `<p>👤 ${j.client_name}</p>` : ''}
        ${j.notes ? `<p>📝 ${j.notes}</p>` : ''}`;
      await sendEmail(myEmail, `🔔 Amanhã: ${j.title}`, html);
      sent++;
    }
    res.json({ ok: true, sent });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Rodando na porta ${PORT}`));
});
