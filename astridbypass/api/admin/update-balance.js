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
    const { user, amount, op } = req.body || {};
    const numAmount = parseFloat(amount) || 0;
    const db = getDb();

    const users = db.users || {};
    let matchedUser = user || '';

    // 1. Exact match
    if (!users[matchedUser]) {
      // 2. Case-insensitive key match
      for (const k of Object.keys(users)) {
        if (k.toLowerCase() === (user || '').trim().toLowerCase()) {
          matchedUser = k;
          break;
        }
      }
    }

    // 3. Match by Discord ID or Global Name
    if (!users[matchedUser]) {
      for (const [k, uData] of Object.entries(users)) {
        if (uData && typeof uData === 'object') {
          if (uData.discordId && String(uData.discordId).trim() === String(user || '').trim()) {
            matchedUser = k;
            break;
          }
          if (uData.globalName && String(uData.globalName).trim().toLowerCase() === String(user || '').trim().toLowerCase()) {
            matchedUser = k;
            break;
          }
        }
      }
    }

    if (!matchedUser) {
      matchedUser = user || 'Kullanici';
    }

    const uInfo = users[matchedUser] || { balance: 0.0, purchases: [] };
    const oldBalance = Number(uInfo.balance) || 0.0;
    let newBalance = oldBalance;
    let opDesc = '';

    if (op === 'add') {
      newBalance = oldBalance + numAmount;
      opDesc = `+${numAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺ Eklendi`;
    } else if (op === 'sub' || op === 'subtract') {
      newBalance = Math.max(0.0, oldBalance - numAmount);
      opDesc = `-${numAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺ Düşüldü`;
    } else if (op === 'reset') {
      newBalance = 0.0;
      opDesc = 'Bakiyeyi Sıfırla (0.00 ₺ Yapıldı)';
    } else { // 'set'
      newBalance = Math.max(0.0, numAmount);
      opDesc = `Doğrudan ${numAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺ Olarak Belirlendi`;
    }

    uInfo.balance = newBalance;
    uInfo.balanceUpdatedAt = Date.now();
    users[matchedUser] = uInfo;
    db.users = users;

    saveDb(db);

    // Discord Admin Webhook Log
    try {
      await fetch('https://discord.com/api/webhooks/1558102967448637453/NZ9XQO_-PUDZhlhw12KZgZIkVf7Dv5tx5HiejI3T5UvNC3URA0FlftjEVUaNcI1Fh-LG', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '💳 Admin Bakiye İşlemi Gerçekleşti',
            description: `Admin tarafından **${matchedUser}** kullanıcısının bakiyesinde işlem yapıldı.`,
            color: 0x8B5CF6,
            fields: [
              { name: '👤 Hedef Kullanıcı', value: '`' + matchedUser + '`', inline: true },
              { name: '🆔 Discord ID', value: '`' + (uInfo.discordId || '-') + '`', inline: true },
              { name: '⚙️ İşlem Detayı', value: `**${opDesc}**`, inline: true },
              { name: '💰 Eski Bakiye', value: `**${oldBalance.toFixed(2)} ₺**`, inline: true },
              { name: '✨ Yeni Bakiye', value: `**${newBalance.toFixed(2)} ₺**`, inline: true },
              { name: '🕒 Zaman', value: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }), inline: true }
            ],
            thumbnail: { url: uInfo.avatar || 'https://files.catbox.moe/hffpzb.png' },
            footer: { text: 'BadSupDev Yönetici Log Sistemi' }
          }]
        })
      });
    } catch (logErr) {
      console.warn('Admin webhook error:', logErr);
    }

    return res.status(200).json({
      success: true,
      user: matchedUser,
      oldBalance,
      newBalance,
      diff: newBalance - oldBalance,
      opDesc
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
