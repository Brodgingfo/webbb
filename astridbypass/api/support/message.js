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
  const sender = body.sender || 'user';
  const senderName = (body.senderName || '').trim();
  const text = (body.text || '').trim();
  const avatar = body.avatar || '';
  const image = body.image || null;

  if (!ticketId) return res.status(400).json({ success: false, error: 'Ticket ID required' });
  if (!text && !image) return res.status(400).json({ success: false, error: 'Mesaj veya görsel gereklidir' });

  const db = getDb();
  db.tickets = db.tickets || [];
  const ticket = db.tickets.find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ success: false, error: 'Talep bulunamadı' });

  if (ticket.status === 'Kapatıldı' && sender === 'user') {
    return res.status(400).json({ success: false, error: 'Bu talep kapatılmıştır.' });
  }
  if (ticket.status === 'Duraklatıldı' && sender === 'user') {
    return res.status(400).json({ success: false, error: 'Bu talep duraklatılmıştır. Yetkili yanıtı bekleniyor.' });
  }

  const nowStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const msgObj = {
    id: 'MSG-' + Date.now(),
    sender,
    senderName: senderName || (sender === 'user' ? ticket.user : '🛡️ BadSupDev Destek'),
    avatar,
    text,
    image,
    timestamp: nowStr
  };

  ticket.messages = ticket.messages || [];
  ticket.messages.push(msgObj);
  ticket.updatedAt = nowStr;

  if (sender === 'admin') {
    ticket.status = 'Yetkili Yanıtladı';
  } else if (sender === 'user' && ticket.status !== 'Açık') {
    ticket.status = 'Açık';
  }

  saveDb(db);

  try {
    const logTitle = sender === 'admin' ? `💬 [Ticket #${ticketId}] Yetkili Yanıt Verdi` : `💬 [Ticket #${ticketId}] Kullanıcı Mesaj Yazdı`;
    const embed = {
      title: logTitle,
      description: `**${msgObj.senderName}**: ${text ? text.slice(0, 1000) : '[Görsel Paylaşıldı]'}`,
      color: sender === 'admin' ? 0x10B981 : 0x38BDF8,
      fields: [
        { name: '📌 Konu', value: '**' + (ticket.subject || '-') + '**', inline: true },
        { name: '👤 Gönderen', value: '`' + msgObj.senderName + '` (' + (sender === 'admin' ? 'Yetkili' : 'Kullanıcı') + ')', inline: true },
        { name: '🕒 Zaman', value: nowStr, inline: true }
      ],
      footer: { text: `Talep No: ${ticketId} • BadSupDev Canlı Destek` }
    };
    if (image && image.startsWith('http')) {
      embed.image = { url: image };
    }

    await fetch('https://discord.com/api/webhooks/1558102559485599826/i0X_kCidYzuF14sPZ6TFAxS2lGKdTI3ERqjfASAmSKZznP5lNcnClJNBm9z7vPm4Os6y', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
  } catch (e) {}

  return res.status(200).json({ success: true, chatMessage: msgObj, ticket });
}
