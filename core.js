import { createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export const TZ = 'Asia/Tashkent';
export function localDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function shiftDay(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s && s >= '2000-01-01' && s <= '2100-12-31'; }
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function authenticate(raw, token, now = Date.now()) {
  if (!token || typeof raw !== 'string' || raw.length > 12000) fail('Telegram orqali qayta oching.', 401);
  const p = new URLSearchParams(raw), pairs = [...p];
  if (new Set(pairs.map(x => x[0])).size !== pairs.length) fail('Yaroqsiz kirish.', 401);
  const hash = p.get('hash') || ''; p.delete('hash');
  const check = [...p].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!/^[a-f0-9]{64}$/.test(hash) || !timingSafeEqual(Buffer.from(hash, 'hex'), expected)) fail('Kirish tasdiqlanmadi.', 401);
  const timestamp = Number(p.get('auth_date')) * 1000;
  if (!Number.isFinite(timestamp) || timestamp > now + 30000 || now - timestamp > 3600000) fail('Sessiya tugadi. Mini App’ni qayta oching.', 401);
  let user; try { user = JSON.parse(p.get('user')); } catch { fail('Yaroqsiz foydalanuvchi.', 401); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) fail('Yaroqsiz foydalanuvchi.', 401);
  return user;
}
export function validateEntry(input, kind) {
  const text = (k, max) => { const s = String(input[k] ?? '').trim(); if (!s || s.length > max) fail(`${k}: maydonni to‘g‘ri to‘ldiring.`); return s; };
  const amount = String(input.amount ?? '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount)) fail('Summani to‘g‘ri kiriting (ko‘pi bilan 2 kasr).');
  const [whole, decimal = ''] = amount.split('.'), minor = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) fail('Summa noldan katta bo‘lsin.');
  if (!validDate(input.date) || input.date > localDate()) fail('Olingan sana bugundan keyin bo‘lmasin.');
  const row = { title: text('title', 160), amount: minor, date: input.date, category: String(input.category || 'Boshqa').slice(0, 50) };
  if (kind === 'debts') {
    if (!validDate(input.dueDate) || input.dueDate < input.date) fail('Qaytarish sanasini tekshiring.');
    row.person = text('person', 100); row.dueDate = input.dueDate;
    row.direction = input.direction === 'lent' ? 'lent' : 'borrowed';
  }
  return row;
}
export function openDB(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path); db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,chat_id INTEGER,created TEXT NOT NULL,reports INTEGER NOT NULL DEFAULT 1,reminders INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS debts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,person TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),date TEXT NOT NULL,due_date TEXT NOT NULL,direction TEXT NOT NULL,paid INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS debts_user ON debts(user_id);
 CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),date TEXT NOT NULL,category TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS expenses_user_date ON expenses(user_id,date);
 CREATE TABLE IF NOT EXISTS outbox(key TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,text TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,ref_id INTEGER);
 CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 PRAGMA user_version=1;`); return db;
}
export function register(db, u, chat = null) { db.prepare(`INSERT INTO users(id,name,chat_id,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,chat_id=COALESCE(excluded.chat_id,users.chat_id)`).run(u.id, String(u.first_name || 'Do‘st').slice(0, 100), chat, localDate()); }
export function snapshot(db, id) {
  return { user: db.prepare('SELECT name,reports,reminders,chat_id IS NOT NULL AS botStarted FROM users WHERE id=?').get(id), today: localDate(), debts: db.prepare('SELECT * FROM debts WHERE user_id=? ORDER BY paid,due_date,id DESC').all(id), expenses: db.prepare('SELECT * FROM expenses WHERE user_id=? ORDER BY date DESC,id DESC').all(id) };
}
export function money(minor) { return new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 2 }).format(minor / 100) + ' so‘m'; }
function enqueue(db, key, u, kind, text, ref = null) { db.prepare('INSERT OR IGNORE INTO outbox(key,user_id,kind,text,ref_id) VALUES(?,?,?,?,?)').run(key, u.id, kind, text, ref); }
export function schedule(db, now = new Date()) {
  const today = localDate(now), yesterday = shiftDay(today, -1);
  for (const u of db.prepare('SELECT * FROM users WHERE chat_id IS NOT NULL').all()) {
    if (u.reminders) {
      for (const d of db.prepare('SELECT * FROM debts WHERE user_id=? AND paid=0 AND due_date<=?').all(u.id, today)) {
        const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
        if (hour < 9) continue;
        enqueue(db, `debt:${d.id}:${d.due_date}:${today}`, u, 'debt', `⏰ Qarz eslatmasi\n${d.person}: ${money(d.amount)}\n${d.title}\nMuddat: ${d.due_date}\n${d.direction === 'lent' ? 'Siz bergan qarz' : 'Siz olgan qarz'}${d.due_date < today ? ' — muddati o‘tgan' : ''}`, d.id);
      }
    }
    if (!u.reports) continue;
    // Persistent cursor recovers missed midnight reports after downtime, 31 per tick.
    const key = `report_cursor:${u.id}`;
    const prior = db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value || shiftDay(u.created, -1);
    let day = shiftDay(prior, 1), count = 0;
    while (day < today && count++ < 31) {
      const periods = [['day', day, day, 'Kunlik']];
      const next = shiftDay(day, 1);
      if (next.slice(8) === '01') periods.push(['month', day.slice(0, 7) + '-01', day, 'Oylik']);
      if (next.slice(5) === '01-01') periods.push(['year', day.slice(0, 4) + '-01-01', day, 'Yillik']);
      db.exec('BEGIN');
      try {
        for (const [type, start, end, label] of periods) {
          const sum = db.prepare('SELECT COALESCE(SUM(amount),0) AS total,COUNT(*) AS count FROM expenses WHERE user_id=? AND date BETWEEN ? AND ?').get(u.id, start, end);
          enqueue(db, `${type}:${u.id}:${day}`, u, 'report', `📊 ${label} xarajat hisoboti\n${start === end ? start : start + ' → ' + end}\nJami: ${money(sum.total)}\nXaridlar: ${sum.count} ta`);
        }
        db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, day); db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      day = next;
    }
  }
}
