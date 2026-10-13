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
    const body = req.body || {};
    const db = getDb();
    const products = db.products || [];
    const pid = body.id || ('prod-' + Math.floor(Date.now() / 1000));

    let features = body.features;
    if (typeof features === 'string') {
      features = features.split('\n').map(s => s.trim()).filter(Boolean);
    } else if (!Array.isArray(features)) {
      features = [];
    }

    const newProd = {
      id: pid,
      title: body.title || 'Yeni Urun',
      category: body.category || 'FiveM Scriptleri',
      price: parseFloat(body.price) || 0,
      period: body.period || 'Tek Seferlik',
      badge: body.badge || '',
      description: body.description || '',
      features: features,
      stock: parseInt(body.stock, 10) || 50
    };

    const idx = products.findIndex(p => p.id === pid);
    if (idx !== -1) {
      products[idx] = newProd;
    } else {
      products.push(newProd);
    }
    db.products = products;

    saveDb(db);

    return res.status(200).json({ success: true, product: newProd, allProducts: products });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
