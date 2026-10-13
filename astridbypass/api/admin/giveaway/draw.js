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
  const gwId = body.giveawayId;

  const db = getDb();
  db.giveaways = db.giveaways || [];
  let targetGw = null;
  if (gwId) {
    targetGw = db.giveaways.find(g => g.id === gwId);
  }
  if (!targetGw) {
    targetGw = db.giveaways.find(g => g.status === 'active');
  }

  if (!targetGw) {
    return res.status(400).json({ success: false, error: 'Sonuçlandırılacak aktif çekiliş bulunamadı' });
  }

  const participants = targetGw.participants || [];
  if (!participants.length) {
    return res.status(400).json({ success: false, error: 'Çekilişe katılan kimse yok! Kazanan belirlenemedi.' });
  }

  const wCount = Math.min(Number(targetGw.winnerCount) || 1, participants.length);
  // Pick random unique winners
  const shuffled = [...participants].sort(() => 0.5 - Math.random());
  const selectedWinners = shuffled.slice(0, wCount);

  targetGw.status = 'ended';
  targetGw.winners = selectedWinners;
  targetGw.drawnAt = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  saveDb(db);

  const winnerMentions = selectedWinners.map(w => {
    return (w.discordId && w.discordId !== '-') ? `<@${w.discordId}> (\`${w.user}\`)` : `**${w.user}**`;
  });
  const wText = winnerMentions.map(m => '🏆 ' + m).join('\n');

  try {
    await fetch('https://discord.com/api/webhooks/1558102559485599826/i0X_kCidYzuF14sPZ6TFAxS2lGKdTI3ERqjfASAmSKZznP5lNcnClJNBm9z7vPm4Os6y', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '@everyone 🎊 **ÇEKİLİŞ SONUÇLANDI!**',
        embeds: [{
          title: '🎊 ÇEKİLİŞ KAZANANLARI: ' + targetGw.title,
          description: 'Çekilişimiz sona erdi! Kazanan şanslı üyelerimiz:\n\n' + wText + '\n\nÖdülünüzü teslim almak için sitemizden **Destek Talebi Oluştur** yapabilir veya Discord yetkililerimize yazabilirsiniz!',
          color: 0x10B981,
          fields: [
            { name: '🎁 Ödül', value: '**' + targetGw.prize + '**', inline: true },
            { name: '👥 Toplam Katılımcı', value: '**' + participants.length + ' Kişi**', inline: true },
            { name: '🕒 Çekiliş Tarihi', value: targetGw.drawnAt, inline: true }
          ],
          thumbnail: { url: 'https://badsupdev.xyz/assets/logo.png' },
          footer: { text: 'Tebrikler! • BadSupDev' }
        }]
      })
    });
  } catch (e) {}

  return res.status(200).json({
    success: true,
    message: 'Çekiliş sonuçlandırıldı!',
    winners: selectedWinners,
    giveaway: targetGw
  });
}
