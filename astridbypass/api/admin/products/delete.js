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
  return { products: [], users: {}, orders: [], deletedProductIds: [] };
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
    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ success: false, error: 'Product ID required' });
    }

    const db = getDb();
    const deletedIds = new Set(db.deletedProductIds || []);
    deletedIds.add(id);
    db.deletedProductIds = Array.from(deletedIds);

    const products = (db.products || []).filter(p => p && p.id !== id && !deletedIds.has(p.id));
    db.products = products;

    saveDb(db);

    return res.status(200).json({
      success: true,
      deletedId: id,
      remaining: products.length
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
