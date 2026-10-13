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
  return { products: [], users: {}, orders: [] };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = String(req.query.key || '').trim().toUpperCase();
  if (!key) return res.status(400).json({ success: false, found: false, error: 'Key parametresi eksik' });

  try {
    const db = getDb();
    const users = db.users || {};
    const orders = db.orders || [];

    let foundOrder = orders.find(o => String(o.key || '').trim().toUpperCase() === key);
    let customer = foundOrder ? foundOrder.user : null;

    if (!foundOrder) {
      for (const [uname, udata] of Object.entries(users)) {
        const p = (udata.purchases || []).find(item => String(item.key || '').trim().toUpperCase() === key);
        if (p) {
          foundOrder = p;
          customer = uname;
          break;
        }
      }
    }

    const found = !!foundOrder;

    // Discord Admin Webhook Log
    try {
      await fetch('https://discord.com/api/webhooks/1558102967448637453/NZ9XQO_-PUDZhlhw12KZgZIkVf7Dv5tx5HiejI3T5UvNC3URA0FlftjEVUaNcI1Fh-LG', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '🔍 Admin Lisans / Key Sorgulama',
            description: `Admin paneli üzerinden lisans anahtarı sorgulaması yapıldı.`,
            color: 0x06B6D4,
            fields: [
              { name: '🔑 Sorgulanan Kod', value: '`' + key + '`', inline: false },
              { name: '📋 Sonuç', value: found ? '✅ Geçerli Lisans Bulundu' : '❌ Bulunamadı / Geçersiz', inline: true },
              { name: '👤 Sahip (Kullanıcı)', value: customer ? `**${customer}**` : 'Bilinmiyor / Yok', inline: true },
              { name: '📦 Ürün', value: foundOrder ? (foundOrder.productTitle || 'Ürün') : '-', inline: true },
              { name: '⏰ Zaman', value: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }), inline: true }
            ],
            footer: { text: 'BadSupDev Yönetici Log Sistemi' }
          }]
        })
      });
    } catch (logErr) {
      console.warn('Admin key webhook error:', logErr);
    }

    if (found) {
      return res.status(200).json({
        success: true,
        found: true,
        orderId: foundOrder.orderId,
        customer,
        productTitle: foundOrder.productTitle,
        price: foundOrder.price,
        date: foundOrder.date,
        key: foundOrder.key
      });
    } else {
      return res.status(200).json({ success: true, found: false, message: 'Bu lisans anahtarı bulunamadı.' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
