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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const db = getDb();
    const id = req.query.id;
    const ticket = (db.tickets || []).find(t => t.id === id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Talep bulunamadı' });
    return res.status(200).json({ success: true, ticket });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const user = (body.user || 'Misafir').trim();
    const discordId = body.discordId || '-';
    const category = body.category || 'Genel';
    const subject = (body.subject || 'Destek Talebi').trim();
    const message = (body.message || '').trim();
    const avatar = body.avatar || '';
    const image = body.image || null;
    const priority = body.priority || 'Normal';

    if (!message && !image) {
      return res.status(400).json({ success: false, error: 'Mesaj veya görsel gereklidir' });
    }

    const ticketId = 'TCK-' + Date.now();
    const nowStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const initialMsg = {
      id: 'MSG-' + Date.now(),
      sender: 'user',
      senderName: user,
      avatar,
      text: message,
      image,
      timestamp: nowStr
    };

    const ticket = {
      id: ticketId,
      user,
      discordId,
      avatar,
      category,
      priority,
      subject,
      message,
      status: 'Açık',
      createdAt: nowStr,
      updatedAt: nowStr,
      messages: [initialMsg]
    };

    const db = getDb();
    db.tickets = db.tickets || [];
    db.tickets.unshift(ticket);
    saveDb(db);

    try {
      const embed = {
        title: '🎫 Yeni Destek Talebi Oluşturuldu',
        description: `**${user}** tarafından yeni bir destek talebi açıldı.`,
        color: 0x3B82F6,
        fields: [
          { name: '👤 Kullanıcı', value: '`' + user + '`', inline: true },
          { name: '🆔 Discord ID', value: '`' + discordId + '`', inline: true },
          { name: '📂 Kategori', value: '**' + category + '**', inline: true },
          { name: '📌 Konu', value: '**' + subject + '**', inline: false },
          { name: '📝 İlk Mesaj', value: '```' + (message ? message.slice(0, 1000) : '[Görsel Paylaşıldı]') + '```', inline: false },
          { name: '🕒 Tarih', value: nowStr, inline: true },
          { name: '📊 Durum', value: '🟢 Açık', inline: true }
        ],
        thumbnail: { url: avatar || 'https://badsupdev.xyz/brand-mark.png' },
        footer: { text: `Talep No: ${ticketId} • BadSupDev Destek Kanalı` }
      };
      if (image && image.startsWith('http')) {
        embed.image = { url: image };
      } else if (image && image.startsWith('data:image')) {
        embed.fields.push({ name: '📷 Görsel', value: 'Ekran görüntüsü panele eklendi.', inline: false });
      }

      await fetch('https://discord.com/api/webhooks/1558102559485599826/i0X_kCidYzuF14sPZ6TFAxS2lGKdTI3ERqjfASAmSKZznP5lNcnClJNBm9z7vPm4Os6y', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      });
    } catch (e) {}

    return res.status(200).json({
      success: true,
      message: 'Destek talebiniz başarıyla iletildi!',
      ticket
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
