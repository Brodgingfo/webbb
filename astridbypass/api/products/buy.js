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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, productId } = req.body || {};
    if (!user || !productId) return res.status(400).json({ error: 'Eksik parametre' });

    const db = getDb();

    const products = db.products || [];
    let product = products.find(p => p.id === productId);
    if (!product) {
      const defaultProducts = [
        { id: "fivem-ultimate-v2", title: "BadSupDev Full V2 FiveM Sunucu Paketi", price: 2500 },
        { id: "discord-guard-bot", title: "Gelişmiş Guard & Sunucu Koruma Botu", price: 650 },
        { id: "custom-inventory-hud", title: "Custom Glassmorphism QB/ESX Envanter Scripti", price: 450 },
        { id: "premium-web-design", title: "Full Responsive Web & Discord Tasarımı", price: 1200 }
      ];
      product = defaultProducts.find(p => p.id === productId);
    }
    if (!product) return res.status(404).json({ error: 'Urun bulunamadi' });

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
    if (!userInfo) {
      userInfo = { balance: 0.0, purchases: [] };
    }

    const price = Number(product.price) || 0;
    const currentBalance = Number(userInfo.balance) || 0;

    if (currentBalance < price) {
      return res.status(400).json({
        error: `Yetersiz bakiye! Urun Fiyati: ${price} TL, Bakiyeniz: ${currentBalance} TL.`
      });
    }

    const newBalance = Math.max(0, currentBalance - price);
    userInfo.balance = newBalance;

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let keyPart = '';
    for (let i = 0; i < 16; i++) {
      if (i > 0 && i % 4 === 0) keyPart += '-';
      keyPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const licenseKey = `BADSUP-${keyPart}`;
    const orderId = `ORD-${Date.now()}`;

    const purchaseRecord = {
      orderId,
      productId: product.id,
      productTitle: product.title,
      price,
      key: licenseKey,
      date: new Date().toLocaleDateString('tr-TR')
    };

    userInfo.purchases = userInfo.purchases || [];
    userInfo.purchases.push(purchaseRecord);
    users[matchedUser] = userInfo;
    db.users = users;

    db.orders = db.orders || [];
    db.orders.push({
      orderId,
      user: matchedUser,
      productTitle: product.title,
      price,
      key: licenseKey,
      date: new Date().toISOString()
    });

    saveDb(db);

    // Discord Sales Webhook Log
    try {
      await fetch('https://discord.com/api/webhooks/1558102761646858270/anwkPMxaBBI_KeCGdC04Abfr0llGTVf9Fc8DOABsoLHLDV2jYhIdUxfSqSTzKfc1TVfV', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '🎉 Yeni Ürün Satın Alındı & Lisans Teslim Edildi!',
            description: `**${matchedUser}** az önce marketten bir ürün satın aldı ve adına lisans anahtarı üretildi.`,
            color: 0x10B981,
            fields: [
              { name: '👤 Satın Alan Müşteri', value: `**${matchedUser}**`, inline: true },
              { name: '📦 Satın Alınan Ürün', value: `**${product.title}**`, inline: true },
              { name: '💰 Ürün Fiyatı', value: `**${price.toFixed(2)} ₺**`, inline: true },
              { name: '💳 Kalan Bakiye', value: `**${newBalance.toFixed(2)} ₺**`, inline: true },
              { name: '🔑 Lisans Anahtarı (Key)', value: '`' + licenseKey + '`', inline: false },
              { name: '🏷️ Sipariş Numarası', value: '`' + orderId + '`', inline: true },
              { name: '⏰ Satın Alma Zamanı', value: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }), inline: true }
            ],
            footer: { text: 'BadSupDev Otomatik Satış & Lisans Sistemi' }
          }]
        })
      });
    } catch (logErr) {
      console.warn('Sales webhook error:', logErr);
    }

    return res.status(200).json({
      success: true,
      newBalance,
      key: licenseKey,
      orderId,
      productTitle: product.title,
      purchase: purchaseRecord
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
