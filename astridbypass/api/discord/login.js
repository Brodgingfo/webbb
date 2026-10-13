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
  return { products: [], users: {}, orders: [], creditedShopierOrders: [] };
}

function saveDb(data) {
  const str = JSON.stringify(data, null, 2);
  try { fs.writeFileSync(tmpDbPath, str, 'utf-8'); } catch (e) {}
  try { fs.writeFileSync(defaultDbPath, str, 'utf-8'); } catch (e) {}
}

export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.redirect('https://badsupdev.xyz/?discord_auth=error&msg=Kod+gelmedi');
  }

  const clientId = process.env.DISCORD_CLIENT_ID || '1537075408720232450';
  const clientSecret = process.env.DISCORD_CLIENT_SECRET || 'REvcTgCw-J6wb59zA5lSWcVWuDESnc_x';
  const redirectUri = 'https://badsupdev.xyz/api/discord/login';

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      const errMsg = tokenData.error_description || tokenData.error || 'Token alinamadi';
      return res.redirect('https://badsupdev.xyz/?discord_auth=error&msg=' + encodeURIComponent(errMsg));
    }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    });
    const user = await userRes.json();

    const avatar = user.avatar
      ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png'
      : 'https://cdn.discordapp.com/embed/avatars/0.png';

    // Register or update user in database so they immediately appear in admin panel!
    try {
      const db = getDb();
      db.users = db.users || {};
      const uName = user.username || 'Kullanici';
      const existing = db.users[uName] || { balance: 0.0, purchases: [] };
      existing.discordId = user.id;
      existing.globalName = user.global_name || user.username;
      existing.avatar = avatar;
      if (user.email) existing.email = user.email;
      db.users[uName] = existing;
      saveDb(db);
    } catch (dbErr) {
      console.warn("DB user save note:", dbErr);
    }

    // Discord Webhook Log (General Weblog)
    try {
      await fetch('https://discord.com/api/webhooks/1558102559485599826/i0X_kCidYzuF14sPZ6TFAxS2lGKdTI3ERqjfASAmSKZznP5lNcnClJNBm9z7vPm4Os6y', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '🚀 Kullanıcı Web Sitesine Giriş Yaptı',
            description: `**${user.username}** (${user.global_name || user.username}) Discord hesabı ile başarıyla giriş yaptı.`,
            color: 0x5865F2,
            fields: [
              { name: '👤 Kullanıcı Adı', value: '`' + user.username + '`', inline: true },
              { name: '🆔 Discord ID', value: '`' + user.id + '`', inline: true },
              { name: '📧 E-posta', value: '`' + (user.email || 'Gizli/Belirtilmemiş') + '`', inline: true },
              { name: '🕒 Zaman', value: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }), inline: true }
            ],
            thumbnail: { url: avatar },
            footer: { text: 'BadSupDev Web Güvenlik & Log Sistemi' }
          }]
        })
      });
    } catch (logErr) {
      console.warn('Webhook log error:', logErr);
    }

    const params = new URLSearchParams({
      discord_auth: 'success',
      user: user.username || '',
      name: user.global_name || user.username || '',
      id: user.id || '',
      avatar: avatar,
    });

    res.redirect('https://badsupdev.xyz/?' + params.toString());
  } catch (err) {
    console.error('Discord OAuth error:', err);
    res.redirect('https://badsupdev.xyz/?discord_auth=error&msg=Sunucu+hatasi');
  }
}
