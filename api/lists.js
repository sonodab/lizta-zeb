// Lizta — guarda as listas no Redis (Upstash, via Vercel Marketplace).
// Cada aparelho envia a chave das listas no cabeçalho X-Lizta-Key; no banco fica só o hash dela.
import { createHash } from 'node:crypto';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const okId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'store_not_configured' });
  const key = String(req.headers['x-lizta-key'] || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(key)) return res.status(400).json({ error: 'bad_key' });
  const h = 'lizta:' + createHash('sha256').update(key).digest('hex');

  try {
    if (req.method === 'GET') {
      const flat = (await redis(['HGETALL', h])) || [];
      const lists = [];
      for (let i = 0; i < flat.length; i += 2) {
        try { lists.push(JSON.parse(flat[i + 1])); } catch {}
      }
      return res.status(200).json({ lists });
    }
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const put = Array.isArray(b.put) ? b.put.slice(0, 200) : [];
      const del = Array.isArray(b.del) ? b.del.filter(okId).slice(0, 200) : [];
      const args = [];
      for (const l of put) {
        if (!l || !okId(l.id)) continue;
        const s = JSON.stringify(l);
        if (s.length > 250000) return res.status(413).json({ error: 'list_too_big' });
        args.push(l.id, s);
      }
      if (args.length) await redis(['HSET', h, ...args]);
      if (del.length) await redis(['HDEL', h, ...del]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(502).json({ error: 'store_error' });
  }
}
