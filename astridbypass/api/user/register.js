import fs from 'fs';
import path from 'path';

const tmpDbPath = '/tmp/db.json';
const defaultDbPath = path.join(process.cwd(), 'db.json');

function getDb() {
  if (fs.existsSync(tmpDbPath)) {
    try { return JSON.parse(fs.readFileSync(tmpDbPath, 'utf-8')); } catch (e) {}
  }
  if (fs.existsSync(defaultDbPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(defaultDbPath, 'utf-8'));
      try { fs.writeFileSync(tmpDbPath, JSON.stringify(data), 'utf-8'); } catch (e) {}
      return data;
    } catch (e) {}
  }
  return { products: [], users: {}, orders: [], creditedShopierOrders: [], tickets: [], giveaways: [] };
}

function saveDb(data) {
  const str = JSON.stringify(data, null, 2);
  try { fs.writeFileSync(tmpDbPath, str, 'utf-8'); } catch (e) {}
  try { fs.writeFileSync(defaultDbPath, str, 'utf-8'); } catch (e) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = req.body || {};
  const user = (body.user || '').trim();
  if (!user) return res.status(400).json({ error: 'User required' });

  const discordId = body.discordId || body.id;
  const globalName = body.globalName || body.name || user;
  const avatar = body.avatar;
  const email = body.email;

  const db = getDb();
  db.users = db.users || {};

  let matched = user;
  for (const k of Object.keys(db.users)) {
    if (k.toLowerCase() === user.toLowerCase()) {
      matched = k;
      break;
    }
  }

  if (!db.users[matched]) {
    db.users[user] = {
      balance: 0.0,
      purchases: [],
      discordId: discordId || null,
      globalName: globalName || user,
      avatar: avatar || null,
      email: email || null,
      createdAt: new Date().toISOString()
    };
    matched = user;
  } else {
    const u = db.users[matched];
    if (discordId) u.discordId = discordId;
    if (globalName) u.globalName = globalName;
    if (avatar) u.avatar = avatar;
    if (email) u.email = email;
  }

  saveDb(db);
  return res.status(200).json({ success: true, user: matched, data: db.users[matched] });
}
