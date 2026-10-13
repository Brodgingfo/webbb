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
  const ticketId = body.ticketId;
  const status = body.status || 'Çözüldü';

  const db = getDb();
  db.tickets = db.tickets || [];
  const ticket = db.tickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, error: 'Talep bulunamadı' });
  }

  const nowStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  ticket.status = status;
  ticket.updatedAt = nowStr;
  ticket.messages = ticket.messages || [];
  ticket.messages.push({
    id: 'MSG-SYS-' + Date.now(),
    sender: 'system',
    senderName: 'Sistem Bildirimi',
    text: `📌 Destek talebinin durumu yetkili tarafından '${status}' olarak güncellendi.`,
    timestamp: nowStr
  });

  saveDb(db);

  try {
    const colorMap = {
      'Açık': 0x3B82F6,
      'Yetkili Yanıtladı': 0x10B981,
      'Duraklatıldı': 0xF59E0B,
      'Çözüldü': 0x10B981,
      'Kapatıldı': 0xEF4444
    };

    const embed = {
      title: `⚙️ [Ticket #${ticketId}] Durum Değiştirildi: ${status}`,
      description: `**${ticket.user || 'Kullanıcı'}** kullanıcısının açtığı **${ticket.subject || '-'}** konulu talebin durumu güncellendi.`,
      color: colorMap[status] || 0x64748B,
      fields: [
        { name: '📊 Yeni Durum', value: `**${status}**`, inline: true },
        { name: '👤 Kullanıcı', value: '`' + (ticket.user || '-') + '`', inline: true },
        { name: '🕒 Zaman', value: nowStr, inline: true }
      ],
      footer: { text: `Talep No: ${ticketId} • BadSupDev Destek Yönetimi` }
    };

    await fetch('https://discord.com/api/webhooks/1558102559485599826/i0X_kCidYzuF14sPZ6TFAxS2lGKdTI3ERqjfASAmSKZznP5lNcnClJNBm9z7vPm4Os6y', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
  } catch (e) {}

  return res.status(200).json({ success: true, ticketId, status, ticket });
}
