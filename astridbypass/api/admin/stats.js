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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = getDb();
    const deletedIds = new Set(db.deletedProductIds || []);
    const prods = Array.isArray(db.products) ? db.products : [];
    const products = prods.filter(p => p && p.id && !deletedIds.has(p.id));
    const users = db.users || {};
    const orders = db.orders || [];

    const stats = {
      totalProducts: products.length,
      totalUsers: Object.keys(users).length,
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, o) => sum + (Number(o.price || o.amount) || 0), 0)
    };

    return res.status(200).json({
      success: true,
      stats,
      products,
      users,
      orders,
      tickets: db.tickets || [],
      giveaways: db.giveaways || []
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
