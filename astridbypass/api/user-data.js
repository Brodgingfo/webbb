import fs from 'fs';
import path from 'path';

const tmpDbPath = '/tmp/db.json';
const defaultDbPath = path.join(process.cwd(), 'db.json');

function getDb() {
  if (fs.existsSync(tmpDbPath)) {
    try {
      return JSON.parse(fs.readFileSync(tmpDbPath, 'utf-8'));
    } catch (e) {}
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
  try {
    fs.writeFileSync(tmpDbPath, str, 'utf-8');
  } catch (e) {}
  try {
    fs.writeFileSync(defaultDbPath, str, 'utf-8');
  } catch (e) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { user, id, name, avatar } = req.query;
  if (!user) {
    return res.status(400).json({ error: 'User required' });
  }

  try {
    const db = getDb();
    const users = db.users || {};
    let matchedUser = user;
    let userInfo = users[user];

    if (!userInfo) {
      for (const [k, v] of Object.entries(users)) {
        if (k.toLowerCase() === user.toLowerCase()) {
          matchedUser = k;
          userInfo = v;
          break;
        }
      }
    }

    let updated = false;
    // Auto-register new users so they appear immediately in admin panel!
    if (!userInfo) {
      userInfo = {
        balance: 0.0,
        purchases: [],
        discordId: id || null,
        globalName: name || user,
        avatar: avatar || null,
        createdAt: new Date().toISOString()
      };
      users[user] = userInfo;
      matchedUser = user;
      updated = true;
    } else {
      // Enrich existing user if info is now available
      if (id && !userInfo.discordId) { userInfo.discordId = id; updated = true; }
      if (avatar && !userInfo.avatar) { userInfo.avatar = avatar; updated = true; }
      if (name && !userInfo.globalName) { userInfo.globalName = name; updated = true; }
    }

    if (updated) {
      db.users = users;
      saveDb(db);
    }

    return res.status(200).json({ success: true, user: matchedUser, data: userInfo });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
