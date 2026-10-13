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
  const title = (body.title || 'Büyük Çekiliş').trim();
  const prize = (body.prize || title).trim();
  const description = (body.description || '').trim();
  const winnerCount = Number(body.winnerCount) || 1;
  const durationMinutes = Number(body.durationMinutes) || 1440;

  const nowTs = Date.now();
  const endTs = nowTs + durationMinutes * 60 * 1000;
  const gwId = 'GW-' + Math.floor(nowTs / 1000);
  const nowStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

  const newGw = {
    id: gwId,
    title,
    prize,
    description,
    winnerCount,
    durationMinutes,
    endTime: endTs,
    status: 'active',
    createdAt: nowStr,
    participants: [],
    winners: []
  };

  const db = getDb();
  db.giveaways = db.giveaways || [];
  db.giveaways.forEach(g => {
    if (g.status === 'active') g.status = 'ended';
  });
  db.giveaways.unshift(newGw);
  saveDb(db);

  try {
    await fetch('https://discord.com/api/webhooks/1558102559485599826/i0X_kCidYzuF14sPZ6TFAxS2lGKdTI3ERqjfASAmSKZznP5lNcnClJNBm9z7vPm4Os6y', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '@everyone 🎉 **YENİ ÇEKİLİŞ BAŞLADI!**',
        embeds: [{
          title: '🎉 ' + title,
          description: (description || 'Yeni çekiliş başladı!') + '\n\n👉 **Hemen katılmak için sitemizi ziyaret edin:** https://badsupdev.xyz/',
          color: 0xF59E0B,
          fields: [
            { name: '🎁 Ödül', value: '**' + prize + '**', inline: true },
            { name: '🏆 Kazanan Sayısı', value: '**' + winnerCount + ' Kişi**', inline: true },
            { name: '⏳ Süre', value: durationMinutes + ' Dakika', inline: true },
            { name: '🕒 Başlangıç', value: nowStr, inline: true }
          ],
          thumbnail: { url: 'https://badsupdev.xyz/assets/logo.png' },
          footer: { text: 'BadSupDev Çekiliş Sistemi' }
        }]
      })
    });
  } catch (e) {}

  return res.status(200).json({
    success: true,
    giveaway: newGw,
    message: 'Çekiliş başarıyla başlatıldı ve Discord duyurusu paylaşıldı!'
  });
}
