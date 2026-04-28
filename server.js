const express = require('express');
const { Pool } = require('pg');
const path = require('path');

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
      payment_status TEXT DEFAULT 'pendente',
      notes TEXT,
      done BOOLEAN DEFAULT false,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  const migrations = [
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_time TIME`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deadline DATE`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pendente'`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL`,
  ];
  for (const sql of migrations) { await pool.query(sql).catch(()=>{}); }
  console.log('Banco pronto.');
}

// CLIENTS
app.get('/api/clients', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM clients ORDER BY name ASC')).rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/clients', async (req, res) => {
  const {name,phone,email} = req.body;
  try { res.json((await pool.query('INSERT INTO clients(name,phone,email) VALUES($1,$2,$3) RETURNING *',[name,phone||null,email||null])).rows[0]); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/clients/:id', async (req, res) => {
  const {name,phone,email} = req.body;
  try { res.json((await pool.query('UPDATE clients SET name=$1,phone=$2,email=$3 WHERE id=$4 RETURNING *',[name,phone||null,email||null,req.params.id])).rows[0]); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/clients/:id', async (req, res) => {
  try { await pool.query('DELETE FROM clients WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/clients/:id/jobs', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM jobs WHERE client_id=$1 ORDER BY date DESC',[req.params.id])).rows); }
  catch(e){ res.status(500).json({error:e.message}); }
});

// JOBS
app.get('/api/jobs', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT j.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
      FROM jobs j LEFT JOIN clients c ON j.client_id=c.id
      ORDER BY j.date ASC, j.start_time ASC NULLS LAST, j.created_at DESC
    `);
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/jobs', async (req, res) => {
  const {title,type,date,start_time,deadline,value,payment_status,notes,client_id} = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO jobs(title,type,date,start_time,deadline,value,payment_status,notes,client_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [title,type,date,start_time||null,deadline||null,value||null,payment_status||'pendente',notes||null,client_id||null]
    );
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/jobs/:id', async (req, res) => {
  const {title,type,date,start_time,deadline,value,payment_status,notes,client_id,done} = req.body;
  try {
    const r = await pool.query(
      `UPDATE jobs SET title=$1,type=$2,date=$3,start_time=$4,deadline=$5,value=$6,
       payment_status=$7,notes=$8,client_id=$9,done=$10 WHERE id=$11 RETURNING *`,
      [title,type,date,start_time||null,deadline||null,value||null,payment_status||'pendente',notes||null,client_id||null,done??false,req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.patch('/api/jobs/:id/toggle', async (req, res) => {
  try { res.json((await pool.query('UPDATE jobs SET done=NOT done WHERE id=$1 RETURNING *',[req.params.id])).rows[0]); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/jobs/:id', async (req, res) => {
  try { await pool.query('DELETE FROM jobs WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Rodando na porta ${PORT}`));
});
