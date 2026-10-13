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
  const discordId = String(body.discordId || '').trim();
  const avatar = body.avatar || '';

  if (!user) {
    return res.status(400).json({ success: false, error: 'Discord ile giriş yapmalısınız' });
  }

  const db = getDb();
  db.giveaways = db.giveaways || [];
  const activeGw = db.giveaways.find(g => g.status === 'active');

  if (!activeGw) {
    return res.status(400).json({ success: false, error: 'Şu anda aktif bir çekiliş bulunmuyor.' });
  }

  activeGw.participants = activeGw.participants || [];
  const already = activeGw.participants.some(p => 
    (discordId && discordId !== '-' && String(p.discordId) === discordId) || 
    (p.user && p.user.toLowerCase() === user.toLowerCase())
  );

  if (already) {
    return res.status(200).json({ success: false, error: 'Bu çekilişe zaten katıldınız!', alreadyJoined: true });
  }

  activeGw.participants.push({
    user,
    discordId: discordId || '-',
    avatar,
    joinedAt: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
  });

  saveDb(db);
  return res.status(200).json({
    success: true,
    message: 'Çekilişe başarıyla katıldınız! Bol şans dileriz!',
    participantCount: activeGw.participants.length
  });
}
