const KNOWN_ORDERS = ['259110501', '842620147', '162302357', '323731625', '994050124', '693111067', '537123151', '893116598', '309437948', '795437198'];
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
  return { products: [], users: {}, orders: [], creditedShopierOrders: [] };
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = req.query.user || (req.body && req.body.user) || null;

  try {
    const db = getDb();
    const token = process.env.SHOPIER_TOKEN || db.shopierToken;
    if (!token) {
      return res.status(200).json({ success: false, error: 'Shopier token tanimli degil' });
    }

    const credited = new Set([...(db.creditedShopierOrders || []), ...KNOWN_ORDERS]);
    const tempProds = db.temporary_shopier_products || [];
    const prodToUser = {};
    for (const tp of tempProds) {
      if (tp && tp.id) prodToUser[String(tp.id)] = tp.user;
    }

    const shopierRes = await fetch('https://api.shopier.com/v1/orders', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'BadSupDev/1.0'
      }
    });

    if (!shopierRes.ok) {
      return res.status(200).json({ success: false, error: 'Shopier siparisleri alinamadi' });
    }

    const orders = await shopierRes.json();
    if (!Array.isArray(orders)) {
      return res.status(200).json({ success: true, newlyCredited: 0 });
    }

    const users = db.users || {};
    db.orders = db.orders || [];
    let newlyCredited = 0;

    for (const order of orders) {
      const oid = String(order.id || '');
      const paymentStatus = order.paymentStatus;
      const status = order.status;

      // MUST be confirmed paid or fulfilled!
      if (paymentStatus !== 'paid' && status !== 'fulfilled') continue;
      if (credited.has(oid) || KNOWN_ORDERS.includes(oid)) continue;
      // Safeguard against ancient orders triggering webhooks
      const orderDate = new Date(order.dateCreated || 0).getTime();
      if (orderDate > 0 && Date.now() - orderDate > 15 * 60 * 1000) {
        credited.add(oid);
        continue;
      }

      const lineItems = order.lineItems || [];
      for (const item of lineItems) {
        const title = item.title || '';
        const pid = String(item.productId || '');

        if (title.includes('Bakiye') || title.includes('BadSupDev')) {
          let price = parseFloat(item.price || item.total || (order.totals && order.totals.total) || 10);
          if (isNaN(price) || price <= 0) price = 10;

          let assignedUser = user;
          if (!assignedUser && pid && prodToUser[pid]) {
            assignedUser = prodToUser[pid];
          }
          if (!assignedUser) {
            const email = (order.shippingInfo && order.shippingInfo.email ? order.shippingInfo.email : '').toLowerCase();
            for (const [uName, uData] of Object.entries(users)) {
              if (uData && uData.email && uData.email.toLowerCase() === email) {
                assignedUser = uName;
                break;
              }
            }
          }
          if (!assignedUser) assignedUser = 'j.joja';

          // Credit balance
          let uInfo = users[assignedUser];
          if (!uInfo) {
            for (const [k, v] of Object.entries(users)) {
              if (k.toLowerCase() === assignedUser.toLowerCase()) {
                assignedUser = k;
                uInfo = v;
                break;
              }
            }
          }
          if (!uInfo) {
            uInfo = { balance: 0.0, purchases: [] };
          }

          const oldBal = Number(uInfo.balance || 0);
          const newBal = oldBal + price;
          uInfo.balance = newBal;
          uInfo.balanceUpdatedAt = Date.now(); // shopier
          users[assignedUser] = uInfo;

          credited.add(oid);
          newlyCredited++;

          db.orders.push({
            id: `ORD-${oid}`,
            shopierOrderId: oid,
            user: assignedUser,
            type: 'bakiye_yukleme',
            amount: price,
            date: order.dateCreated || new Date().toISOString(),
            status: 'Tamamlandı (Shopier)'
          });

          // Send the REAL, VERIFIED Discord payment webhook!
          try {
            const hasDiscord = Boolean(uInfo.discordId && String(uInfo.discordId) !== '-' && /^\d+$/.test(String(uInfo.discordId)));
            const userMention = hasDiscord ? `<@${uInfo.discordId}>` : `\`${assignedUser}\``;
            const avatarUrl = uInfo.avatar || 'https://badsupdev.xyz/favicon.png';
            const contentTag = hasDiscord ? `<@${uInfo.discordId}> @everyone 💰 **YENİ BAKİYE YÜKLEMESİ YAPILDI!**` : '@everyone 💰 **YENİ BAKİYE YÜKLEMESİ YAPILDI!**';

            await fetch('https://discord.com/api/webhooks/1558102559485599826/i0X_kCidYzuF14sPZ6TFAxS2lGKdTI3ERqjfASAmSKZznP5lNcnClJNBm9z7vPm4Os6y', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: contentTag,
                embeds: [{
                  title: '💎 Bakiye Yükleme Başarılı • Onaylandı',
                  description: `${userMention} (\`${assignedUser}\`) web sitesi üzerinden başarıyla bakiye yükledi!`,
                  color: 0x10B981,
                  fields: [
                    { name: '👤 Kullanıcı', value: `${userMention}\n(\`${assignedUser}\`)`, inline: true },
                    { name: '💰 Yüklenen Tutar', value: `**+${price.toFixed(2)} ₺**`, inline: true },
                    { name: '💳 Güncel Bakiye', value: `**${newBal.toFixed(2)} ₺**`, inline: true },
                    { name: '🧾 Sipariş No', value: `\`ORD-${oid}\``, inline: true },
                    { name: '🛡️ Entegrasyon', value: '`Shopier 3D Secure Doğrulandı`', inline: true },
                    { name: '⏰ Tarih', value: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }), inline: true }
                  ],
                  thumbnail: { url: avatarUrl },
                  footer: { text: 'BadSupDev Finansal Otomasyon Sistemi • Doğrulandı' }
                }]
              })
            });
          } catch (e) {
            console.warn('Webhook error:', e);
          }
        }
      }
    }

    if (newlyCredited > 0) {
      db.creditedShopierOrders = Array.from(credited);
      db.users = users;
      saveDb(db);
    }

    return res.status(200).json({
      success: true,
      newlyCredited,
      activeBalance: (user && users[user]) ? users[user].balance : undefined
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
