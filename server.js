require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const env = process.env;
const PORT = env.PORT || 8080;
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';
const SECRET = env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
if (ADMIN_PASSWORD.length < 8) { console.error('ADMIN_PASSWORD .env file mein set karein (kam se kam 8 characters).'); process.exit(1); }

const ADVANCE_PERCENT = Math.min(100, Math.max(1, +env.ADVANCE_PERCENT || 20));
const RZP_ID = env.RAZORPAY_KEY_ID, RZP_SECRET = env.RAZORPAY_KEY_SECRET;
const PAY_ON = !!(RZP_ID && RZP_SECRET);
const SITE_URL = (env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const WA = (env.WHATSAPP_NUMBER || '919927706844').replace(/\D/g, '');
const RENTAL = 'Only bike rental';
const BOOKING_STATUS = ['new', 'contacted', 'confirmed', 'cancelled'];
const PAY_STATUS = ['unpaid', 'paid', 'refunded'];

/* ================= DATABASE (SQLite: data/app.db) ================= */
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new Database(path.join(__dirname, 'data', 'app.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS packages(key TEXT PRIMARY KEY, name TEXT NOT NULL, tags TEXT DEFAULT '', days INTEGER DEFAULT 1, km TEXT DEFAULT '', price INTEGER NOT NULL DEFAULT 0, img TEXT DEFAULT '', bg TEXT DEFAULT '#456,#9ab', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone TEXT DEFAULT '', pass TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, name TEXT NOT NULL, email TEXT DEFAULT '', phone TEXT NOT NULL, pkg TEXT NOT NULL, date TEXT NOT NULL, riders INTEGER NOT NULL, msg TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'new', total INTEGER NOT NULL DEFAULT 0, advance INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, pay_status TEXT NOT NULL DEFAULT 'unpaid', order_id TEXT, payment_id TEXT, ptoken TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, n TEXT NOT NULL, c TEXT DEFAULT '', t TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_b_cust ON bookings(customer_id);
`);
const now = () => new Date().toISOString();
const rand = () => crypto.randomBytes(16).toString('hex');

// Purana data/db.json (version 1) ho to SQLite mein import
const OLD = path.join(__dirname, 'data', 'db.json');
if (fs.existsSync(OLD)) {
  try {
    const o = JSON.parse(fs.readFileSync(OLD, 'utf8'));
    const ib = db.prepare('INSERT INTO bookings(name,phone,pkg,date,riders,msg,status,created,ptoken) VALUES(?,?,?,?,?,?,?,?,?)');
    const ir = db.prepare('INSERT INTO reviews(n,c,t,approved) VALUES(?,?,?,?)');
    db.transaction(() => {
      (o.bookings || []).forEach(b => ib.run(b.name, b.phone, b.pkg, b.date, b.riders, b.msg || '', b.status || 'new', b.createdAt || now(), rand()));
      (o.reviews || []).forEach(r => ir.run(r.n, r.c || '', r.t, r.approved ? 1 : 0));
    })();
    fs.renameSync(OLD, OLD + '.migrated');
    console.log('Purana db.json SQLite mein import ho gaya.');
  } catch (e) { console.error('Purana data import nahi hua:', e.message); }
}
if (!db.prepare('SELECT COUNT(*) c FROM reviews').get().c) {
  const ir = db.prepare('INSERT INTO reviews(n,c,t) VALUES(?,?,?)');
  [['Rohit Sharma', 'Delhi', 'The entire experience was beyond amazing. The team was professional, the bikes were in top condition, and the views... just surreal!'],
   ['Neha Verma', 'Bangalore', 'Om Parvat is a place you have to experience at least once in your life. Thanks to the team for making it so smooth and memorable!'],
   ['Aman Singh', 'Lucknow', 'Best decision ever! From the booking process to the ride, everything was well organized. Highly recommended!']].forEach(r => ir.run(...r));
}
if (!db.prepare('SELECT COUNT(*) c FROM packages').get().c) {
  const ip = db.prepare('INSERT INTO packages(key,name,tags,days,km,price,img,bg,sort) VALUES(?,?,?,?,?,?,?,?,?)');
  ip.run('om', 'Om Parvat Expedition', 'Spiritual Ride | Breathtaking Views', 8, '5,500', 28999, 'Images_2/OM.jpg.jpg', '#456,#9ab', 1);
  ip.run('adi', 'Adi Kailash Yatra', 'Adventure | Spiritual | Offbeat', 10, '6,800', 34999, 'Images_2/adikailesh.jpg.jpg', '#345,#b88', 2);
  ip.run('combo', 'Combo: Om Parvat + Adi Kailash', 'Complete Himalayan Experience', 14, '9,500', 49999, 'images/g1.jpg.png', '#654,#89a', 3);
}

/* ================= HELPERS ================= */
const clean = (v, max, multi = false) => String(v ?? '').replace(multi ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const bad = (res, error, code = 400) => res.status(code).json({ error });
const rs = n => 'Rs. ' + Number(n).toLocaleString('en-IN');
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };

// Tokens (admin + customer)
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
function makeToken(payload, hours) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + hours * 3600e3 })).toString('base64url');
  return body + '.' + sign(body);
}
function readToken(t) {
  const [body, sig] = String(t || '').split('.');
  if (!body || !sig || !safeEq(sig, sign(body))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const bearer = req => (req.get('authorization') || '').replace(/^Bearer /, '');
const adminOnly = (req, res, next) => readToken(bearer(req))?.role === 'admin' ? next() : bad(res, 'Unauthorized', 401);
const custOnly = (req, res, next) => { const p = readToken(bearer(req)); if (p?.role !== 'cust') return bad(res, 'Please login', 401); req.cid = p.id; next(); };

// Passwords (scrypt)
const hashPw = pw => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const checkPw = (pw, st) => { const [s, h] = String(st).split(':'); return safeEq(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64).toString('hex'), h); };

/* ================= EMAIL + WHATSAPP ALERTS ================= */
let mailer = null;
if (env.SMTP_HOST) mailer = require('nodemailer').createTransport({ host: env.SMTP_HOST, port: +env.SMTP_PORT || 587, secure: env.SMTP_PORT === '465', auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
async function mail(to, subject, text) {
  if (!mailer || !to) return;
  try { await mailer.sendMail({ from: `"Himalayan Rides" <${env.SMTP_USER}>`, to, subject, text }); }
  catch (e) { console.error('Email nahi gaya:', e.message); }
}
async function whatsappOwner(b) {
  const p = env.WHATSAPP_PROVIDER, to = (env.OWNER_WHATSAPP || '').replace(/\D/g, '');
  if (!p || !to) return;
  try {
    if (p === 'callmebot') {
      const text = `New booking #${b.id}: ${b.name} (${b.phone}) - ${b.pkg}, start ${b.date}, ${b.riders} riders`;
      await fetch(`https://api.callmebot.com/whatsapp.php?phone=${to}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(env.CALLMEBOT_APIKEY || '')}`);
    } else if (p === 'cloud') {
      const r = await fetch(`https://graph.facebook.com/v20.0/${env.WA_CLOUD_PHONE_ID}/messages`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + env.WA_CLOUD_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: env.WA_CLOUD_TEMPLATE || 'new_booking', language: { code: 'en' },
          components: [{ type: 'body', parameters: [b.name, b.pkg, b.date, b.phone].map(text => ({ type: 'text', text: String(text).slice(0, 100) })) }] } })
      });
      if (!r.ok) console.error('WhatsApp Cloud error:', await r.text());
    }
  } catch (e) { console.error('WhatsApp alert nahi gaya:', e.message); }
}
function onNewBooking(b) {
  mail(env.NOTIFY_EMAIL, `New booking #${b.id}: ${b.pkg}`, `Name: ${b.name}\nPhone: ${b.phone}\nEmail: ${b.email}\nPackage: ${b.pkg}\nStart date: ${b.date}\nRiders: ${b.riders}\nTotal: ${rs(b.total)}  |  Advance: ${rs(b.advance)}\nMessage: ${b.msg || '-'}`);
  whatsappOwner(b);
  mail(b.email, `We received your booking request #${b.id}`, `Hi ${b.name},\n\nThanks for choosing Himalayan Rides! We received your request for ${b.pkg} starting ${b.date} (${b.riders} rider${b.riders > 1 ? 's' : ''}).\n${b.advance ? `Advance to confirm your seat: ${rs(b.advance)}${PAY_ON ? ` - pay anytime from ${SITE_URL}/my.html` : ''}\n` : ''}\nOur team will call you shortly.\n\nBooking ID: #${b.id}\nHimalayan Rides`);
}
const onConfirmed = b => mail(b.email, `Your booking #${b.id} is confirmed!`, `Hi ${b.name},\n\nGreat news - your booking is CONFIRMED.\n\nPackage: ${b.pkg}\nStart date: ${b.date}\nRiders: ${b.riders}\nTotal: ${rs(b.total)}  |  Paid so far: ${rs(b.paid)}\n\nWe will share the final itinerary and packing list soon. Questions? WhatsApp us: https://wa.me/${WA}\n\nHimalayan Rides`);
const onPaid = b => mail(b.email, `Payment received for booking #${b.id}`, `Hi ${b.name},\n\nWe received your advance payment of ${rs(b.paid)} for booking #${b.id} (${b.pkg}, ${b.date}).\nBalance to pay later: ${rs(Math.max(0, b.total - b.paid))}\n\nThank you!\nHimalayan Rides`);

/* ================= RAZORPAY ================= */
async function rzpOrder(body) {
  const r = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(RZP_ID + ':' + RZP_SECRET).toString('base64') }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.description || 'Razorpay error');
  return d;
}
function markPaid(id, paymentId, amountRs) {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  if (!b || b.pay_status === 'paid') return b;
  db.prepare("UPDATE bookings SET pay_status='paid', paid=?, payment_id=? WHERE id=?").run(amountRs ?? b.advance, paymentId || null, id);
  const nb = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  onPaid(nb); return nb;
}
const publicBooking = b => ({ id: b.id, pkg: b.pkg, date: b.date, riders: b.riders, status: b.status, total: b.total, advance: b.advance, paid: b.paid, pay_status: b.pay_status, created: b.created });

/* ================= APP ================= */
const app = express();
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
const devOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const allowed = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN.split(',') : null;
app.use('/api', cors({ origin: (o, cb) => cb(null, !o || (allowed ? allowed.includes(o) : devOrigin.test(o))) }));

// Razorpay webhook (raw body chahiye, isliye express.json se pehle)
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '200kb' }), (req, res) => {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(200).json({ ok: true, ignored: true });
  const good = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  if (!safeEq(req.get('x-razorpay-signature') || '', good)) return bad(res, 'Bad signature', 400);
  try {
    const ev = JSON.parse(req.body.toString());
    if (ev.event === 'order.paid') {
      const o = ev.payload.order.entity, pay = ev.payload.payment?.entity;
      const id = +String(o.receipt || '').replace(/^bk/, '');
      if (id) markPaid(id, pay?.id, Math.round((o.amount_paid || 0) / 100) || undefined);
    }
  } catch (e) { console.error('Webhook error:', e.message); }
  res.json({ ok: true });
});

app.use(express.json({ limit: '20kb' }));
const lim = (mins, max, msg) => rateLimit({ windowMs: mins * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: msg || 'Bahut zyada requests. Thodi der baad try karein.' } });
const bookingLimiter = lim(60, 8), authLimiter = lim(15, 15, 'Bahut zyada login try. 15 minute baad dobara karein.'), payLimiter = lim(60, 20), claimLimiter = lim(60, 10);

/* ----- Public ----- */
app.get('/api/config', (req, res) => res.json({ whatsapp: WA, payEnabled: PAY_ON, advancePercent: ADVANCE_PERCENT }));
app.get('/api/packages', (req, res) => res.json(db.prepare('SELECT key,name,tags,days,km,price,img,bg FROM packages WHERE active=1 ORDER BY sort,rowid').all()));
app.get('/api/reviews', (req, res) => res.json(db.prepare('SELECT n,c,t FROM reviews WHERE approved=1 ORDER BY id').all()));

app.post('/api/bookings', bookingLimiter, (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80), phone = clean(b.phone, 20), email = clean(b.email, 120).toLowerCase(), pkgName = clean(b.pkg, 80);
  const date = clean(b.date, 10), msg = clean(b.msg, 500, true), riders = Number(b.riders), digits = phone.replace(/\D/g, '');
  if (name.length < 2) return bad(res, 'Please enter your name.');
  if (!/^[+\d\s()-]+$/.test(phone) || digits.length < 10 || digits.length > 13) return bad(res, 'Please enter a valid phone number.');
  if (!emailOk(email)) return bad(res, 'Please enter a valid email.');
  const pkg = pkgName === RENTAL ? { name: RENTAL, price: 0 } : db.prepare('SELECT name,price FROM packages WHERE active=1 AND name=?').get(pkgName);
  if (!pkg) return bad(res, 'Please choose a valid package.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)) || date < today()) return bad(res, 'Please choose a valid future date.');
  if (!Number.isInteger(riders) || riders < 1 || riders > 20) return bad(res, 'Riders must be between 1 and 20.');

  const tok = readToken(bearer(req)), cid = tok?.role === 'cust' ? tok.id : null;
  const total = pkg.price * riders, advance = Math.round(total * ADVANCE_PERCENT / 100), ptoken = rand();
  const info = db.prepare('INSERT INTO bookings(customer_id,name,email,phone,pkg,date,riders,msg,total,advance,ptoken,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(cid, name, email, phone, pkg.name, date, riders, msg, total, advance, ptoken, now());
  const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(info.lastInsertRowid);
  onNewBooking(row);
  res.status(201).json({ ok: true, id: row.id, ptoken, total, advance, payEnabled: PAY_ON && advance > 0 });
});

/* ----- Payments ----- */
app.post('/api/payments/order', payLimiter, async (req, res) => {
  if (!PAY_ON) return bad(res, 'Online payment abhi chalu nahi hai.');
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(+req.body?.id);
  const tok = readToken(bearer(req));
  const ok = b && (safeEq(req.body?.ptoken || '', b.ptoken) || (tok?.role === 'cust' && b.customer_id === tok.id));
  if (!ok) return bad(res, 'Booking nahi mili.', 404);
  const due = b.advance - b.paid;
  if (b.pay_status === 'paid' || due <= 0) return bad(res, 'Is booking ka advance already paid hai.');
  if (b.status === 'cancelled') return bad(res, 'Ye booking cancel ho chuki hai.');
  try {
    const o = await rzpOrder({ amount: due * 100, currency: 'INR', receipt: 'bk' + b.id });
    db.prepare('UPDATE bookings SET order_id=? WHERE id=?').run(o.id, b.id);
    res.json({ orderId: o.id, amount: o.amount, key: RZP_ID, name: b.name, email: b.email, phone: b.phone });
  } catch (e) { console.error('Order error:', e.message); bad(res, 'Payment shuru nahi ho paya. Thodi der baad try karein.', 502); }
});
app.post('/api/payments/verify', payLimiter, (req, res) => {
  const { id, razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(+id);
  if (!PAY_ON || !b || !oid || !pid || !sig || b.order_id !== oid) return bad(res, 'Invalid payment');
  const good = crypto.createHmac('sha256', RZP_SECRET).update(oid + '|' + pid).digest('hex');
  if (!safeEq(sig, good)) return bad(res, 'Payment verify nahi hui');
  markPaid(b.id, pid);
  res.json({ ok: true });
});

/* ----- Customers ----- */
app.post('/api/customers/register', authLimiter, (req, res) => {
  const name = clean(req.body?.name, 80), email = clean(req.body?.email, 120).toLowerCase(), phone = clean(req.body?.phone, 20), pw = String(req.body?.password || '');
  if (name.length < 2) return bad(res, 'Please enter your name.');
  if (!emailOk(email)) return bad(res, 'Please enter a valid email.');
  if (pw.length < 8 || pw.length > 100) return bad(res, 'Password kam se kam 8 characters ka rakhein.');
  if (db.prepare('SELECT 1 FROM customers WHERE email=?').get(email)) return bad(res, 'Is email se account pehle se hai. Login karein.', 409);
  const info = db.prepare('INSERT INTO customers(name,email,phone,pass,created) VALUES(?,?,?,?,?)').run(name, email, phone, hashPw(pw), now());
  res.status(201).json({ token: makeToken({ role: 'cust', id: info.lastInsertRowid }, 24 * 14), name });
});
app.post('/api/customers/login', authLimiter, (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE email=?').get(clean(req.body?.email, 120).toLowerCase());
  if (!c || !checkPw(String(req.body?.password || ''), c.pass)) return bad(res, 'Email ya password galat hai.', 401);
  res.json({ token: makeToken({ role: 'cust', id: c.id }, 24 * 14), name: c.name });
});
app.get('/api/me', custOnly, (req, res) => {
  const c = db.prepare('SELECT name,email,phone FROM customers WHERE id=?').get(req.cid);
  c ? res.json(c) : bad(res, 'Please login', 401);
});
app.get('/api/me/bookings', custOnly, (req, res) => res.json(db.prepare('SELECT * FROM bookings WHERE customer_id=? ORDER BY id DESC').all(req.cid).map(publicBooking)));
app.post('/api/me/claim', claimLimiter, custOnly, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(+req.body?.id);
  const last10 = s => String(s).replace(/\D/g, '').slice(-10);
  if (!b || b.customer_id || last10(b.phone) !== last10(req.body?.phone || '') || last10(req.body?.phone || '').length < 10) return bad(res, 'Booking ID aur phone number match nahi hue.', 404);
  db.prepare('UPDATE bookings SET customer_id=? WHERE id=?').run(req.cid, b.id);
  res.json({ ok: true });
});

/* ----- Admin ----- */
app.post('/api/admin/login', authLimiter, (req, res) => {
  if (!safeEq(crypto.createHash('sha256').update(String(req.body?.password ?? '')).digest('hex'), crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex'))) return bad(res, 'Wrong password', 401);
  res.json({ token: makeToken({ role: 'admin' }, 12) });
});
app.get('/api/admin/bookings', adminOnly, (req, res) => res.json(db.prepare('SELECT id,customer_id,name,email,phone,pkg,date,riders,msg,status,total,advance,paid,pay_status,payment_id,created FROM bookings ORDER BY id DESC').all()));
app.patch('/api/admin/bookings/:id', adminOnly, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(+req.params.id);
  if (!b) return bad(res, 'Not found', 404);
  const { status, pay_status } = req.body || {};
  if (status !== undefined) {
    if (!BOOKING_STATUS.includes(status)) return bad(res, 'Invalid status');
    db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status, b.id);
  }
  if (pay_status !== undefined) {
    if (!PAY_STATUS.includes(pay_status)) return bad(res, 'Invalid payment status');
    db.prepare('UPDATE bookings SET pay_status=?, paid=? WHERE id=?').run(pay_status, pay_status === 'paid' ? Math.max(b.paid, b.advance) : pay_status === 'unpaid' ? 0 : b.paid, b.id);
  }
  const nb = db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id);
  if (status === 'confirmed' && b.status !== 'confirmed') onConfirmed(nb);
  res.json(nb);
});
app.delete('/api/admin/bookings/:id', adminOnly, (req, res) =>
  db.prepare('DELETE FROM bookings WHERE id=?').run(+req.params.id).changes ? res.json({ ok: true }) : bad(res, 'Not found', 404));

const pkgFields = body => {
  const name = clean(body?.name, 80), price = Number(body?.price), days = Number(body?.days);
  const img = clean(body?.img, 200), bg = clean(body?.bg, 40) || '#456,#9ab';
  if (name.length < 2) return { error: 'Package ka naam likhein.' };
  if (!Number.isInteger(price) || price < 0 || price > 10000000) return { error: 'Price sahi likhein (sirf number).' };
  if (!Number.isInteger(days) || days < 1 || days > 90) return { error: 'Days 1 se 90 ke beech rakhein.' };
  if (!/^[\w\-./ ()]*$/.test(img)) return { error: 'Image path mein sirf letters, numbers aur / . - _ allowed hain.' };
  if (!/^#[0-9a-f]{3,8},#[0-9a-f]{3,8}$/i.test(bg)) return { error: 'Colors aise likhein: #456,#9ab' };
  return { v: [name, clean(body?.tags, 120), days, clean(body?.km, 20), price, img, bg, body?.active === false || body?.active === 0 ? 0 : 1, Math.round(Number(body?.sort)) || 0] };
};
app.get('/api/admin/packages', adminOnly, (req, res) => res.json(db.prepare('SELECT * FROM packages ORDER BY sort,rowid').all()));
app.post('/api/admin/packages', adminOnly, (req, res) => {
  const f = pkgFields(req.body); if (f.error) return bad(res, f.error);
  const key = 'p' + Date.now().toString(36);
  db.prepare('INSERT INTO packages(name,tags,days,km,price,img,bg,active,sort,key) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...f.v, key);
  res.status(201).json({ ok: true, key });
});
app.put('/api/admin/packages/:key', adminOnly, (req, res) => {
  const f = pkgFields(req.body); if (f.error) return bad(res, f.error);
  db.prepare('UPDATE packages SET name=?,tags=?,days=?,km=?,price=?,img=?,bg=?,active=?,sort=? WHERE key=?').run(...f.v, req.params.key).changes ? res.json({ ok: true }) : bad(res, 'Not found', 404);
});
app.get('/api/admin/reviews', adminOnly, (req, res) => res.json(db.prepare('SELECT id,n,c,t,approved FROM reviews ORDER BY id DESC').all()));
app.post('/api/admin/reviews', adminOnly, (req, res) => {
  const n = clean(req.body?.n, 60), c = clean(req.body?.c, 60), t = clean(req.body?.t, 400);
  if (n.length < 2 || t.length < 10) return bad(res, 'Name aur review likhein');
  res.status(201).json({ id: db.prepare('INSERT INTO reviews(n,c,t) VALUES(?,?,?)').run(n, c, t).lastInsertRowid });
});
app.delete('/api/admin/reviews/:id', adminOnly, (req, res) => { db.prepare('DELETE FROM reviews WHERE id=?').run(+req.params.id); res.json({ ok: true }); });

app.use('/api', (req, res) => bad(res, 'Not found', 404));

/* ----- Website + admin page ----- */
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return bad(res, 'Invalid request');
  console.error(err); bad(res, 'Server error', 500);
});

app.listen(PORT, () => {
  console.log(`Server chal raha hai: http://localhost:${PORT}  |  Admin: http://localhost:${PORT}/admin`);
  console.log(`Payment: ${PAY_ON ? 'ON (Razorpay)' : 'OFF'} | Email: ${mailer ? 'ON' : 'OFF'} | WhatsApp alert: ${env.WHATSAPP_PROVIDER || 'OFF'}`);
});