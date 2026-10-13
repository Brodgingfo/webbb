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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, user } = req.body || {};
    const parsedAmount = parseFloat(amount);

    if (!parsedAmount || parsedAmount < 10) {
      return res.status(400).json({ success: false, error: "Minimum bakiye yukleme tutari 10 TL'dir." });
    }

    const db = getDb();
    const token = process.env.SHOPIER_TOKEN || db.shopierToken || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI2M2Q2ZjNiZmFkZWExYWQzMmE5NGQ1YWFlOTNkOWJiNiIsImp0aSI6ImI0ZmIyYzMxYjAzYmU0MjkyMjNmZGE3OTNmY2UwNDUzNDYyNTlkZDNjM2YzZjFjYTM4Njk5ZjAxN2QzYjEyZmU4ZmVhMjM5YzIxNzI4MjA0ODJmN2NkZmYzOGM4MGZiZDgwZWRiYTNmMTJjMzcwYjIzOWE3ZDE3ZGM2NGUwZGUyNzk3MzBlNDI2ZmZhYmM0OWY3OGQxMWEyYzg4YzVmMzIiLCJpYXQiOjE3OTE1MzIxMDIsIm5iZiI6MTc5MTUzMjEwMiwiZXhwIjoxOTQ5MzE2ODYyLCJzdWIiOjMwMjI2MDAsInNjb3BlcyI6WyJvcmRlcnM6cmVhZCIsIm9yZGVyczp3cml0ZSIsInByb2R1Y3RzOnJlYWQiLCJwcm9kdWN0czp3cml0ZSIsInNoaXBwaW5nczpyZWFkIiwic2hpcHBpbmdzOndyaXRlIiwiZGlzY291bnRzOnJlYWQiLCJkaXNjb3VudHM6d3JpdGUiLCJwYXlvdXRzOnJlYWQiLCJyZWZ1bmRzOnJlYWQiLCJyZWZ1bmRzOndyaXRlIiwic2hvcDpyZWFkIiwic2hvcDp3cml0ZSJdfQ.ihc_eyYcBvI3DH-_DLrm3LTKk9u-F9iZ_0WXIBCdhpIqRzdOsn0Al05qYYrNiHRvzu7F3tdxeFgndeffJQxhOoXMbZIpp9lV_4_UgnI31562qP5TOyeuacaoWTzvb3T7astPUesDo3ZGaZq0UCOiCssyDMuie3c5rcMG4y0vF1y0NKa-NNRJmzFcVyvdjicaeLCODHxrMVS0mSR04rFG3JzFX9YtT-QVz4tDKfsrHTIm7xG5LfRo-krMlIIO-2FoY5ovil8kKVrpFSewSF01SDaCenggOYHQHB1WejKp49qn2pzNr7n0K8lQqxPpzvtTC_nOQBXtRdr1Upy4UGNA6A';

    const shopierRes = await fetch('https://api.shopier.com/v1/products', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'BadSupDev/1.0'
      },
      body: JSON.stringify({
        title: `BadSupDev Bakiye Yukleme (${parsedAmount} TL)`,
        description: `Kullanici: ${user || 'Misafir'} | BadSupDev Bakiye Yukleme`,
        type: 'digital',
        media: [{
          type: 'image',
          url: 'https://cdn.discordapp.com/embed/avatars/0.png',
          placement: 1
        }],
        priceData: {
          currency: 'TRY',
          price: parsedAmount
        },
        stockQuantity: 100,
        shippingPayer: 'sellerPays'
      })
    });

    const data = await shopierRes.json();

    if (data && data.url) {
      // Track temporary product with username for automatic matching when payment completes
      const tempId = String(data.id || '');
      if (tempId) {
        db.temporary_shopier_products = db.temporary_shopier_products || [];
        db.temporary_shopier_products.push({
          id: tempId,
          user: user || 'Misafir',
          amount: parsedAmount,
          time: Date.now() / 1000
        });
        saveDb(db);
      }

      // NO premature Discord webhook! Payment has NOT occurred yet.
      return res.status(200).json({
        success: true,
        amount: parsedAmount,
        url: data.url,
        productId: data.id,
        user: user || 'Misafir'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Shopier urun olusturulamadi',
        details: data
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
