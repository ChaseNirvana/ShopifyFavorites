/**
 * Vercel serverless function: /api/watch-progress
 *
 * Stores per-customer video progress in the customer metafield
 * custom.watch_progress (type: json), keyed by product handle:
 *   { "<handle>": { "pct": 45, "sec": 312, "at": 1718000000000 }, ... }
 *
 * Deploy this alongside your existing favorites function. It uses the Shopify
 * Admin GraphQL API (which is why the write has to happen server-side — the
 * storefront cannot write customer metafields).
 *
 * Environment variables (reuses the names already set on the favorites project):
 *   SHOP_DOMAIN      e.g. your-store.myshopify.com
 *   ADMIN_API_TOKEN  Admin API access token with read/write_customers
 *   STORE_ORIGIN     your storefront origin, e.g. https://www.cookingwithloveclub.com
 *
 * Request (POST, JSON):
 *   { "customerId": "1234567890", "handle": "lemon-chicken", "pct": 45, "sec": 312 }
 *
 * Note on trust: like the favorites endpoint, this trusts the customerId sent
 * from the browser. For stronger security, move this behind a Shopify App Proxy
 * (so requests are HMAC-signed by Shopify) or verify a Customer Account API token.
 */

const API_VERSION = '2024-10';
const MAX_ENTRIES = 60; // keep the metafield small; drop oldest beyond this

async function shopifyGraphQL(query, variables) {
  // Built per-request (after the env guard) so a missing store domain can't
  // silently produce "https://undefined/...".
  const store = process.env.SHOP_DOMAIN;
  const adminGraphql = `https://${store}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(adminGraphql, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env.ADMIN_API_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.STORE_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Fail loudly + clearly if the environment isn't configured.
  const missing = ['SHOP_DOMAIN', 'ADMIN_API_TOKEN'].filter((k) => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ error: 'Missing env vars', missing });
  }
  if (typeof fetch !== 'function') {
    return res.status(500).json({ error: 'global fetch is undefined — set the Vercel project to Node 18+' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { customerId, handle } = body;
    let pct = Number(body.pct);
    let sec = Number(body.sec);

    if (!customerId || !handle) {
      return res.status(400).json({ error: 'customerId and handle are required' });
    }
    pct = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
    sec = Number.isFinite(sec) ? Math.max(0, Math.round(sec)) : 0;

    const ownerId = `gid://shopify/Customer/${String(customerId).replace(/\D/g, '')}`;

    // 1. Read existing progress
    const readData = await shopifyGraphQL(
      `query Read($id: ID!) {
        customer(id: $id) {
          metafield(namespace: "custom", key: "watch_progress") { value }
        }
      }`,
      { id: ownerId }
    );

    let progress = {};
    const existing = readData?.customer?.metafield?.value;
    if (existing) {
      try { progress = JSON.parse(existing) || {}; } catch (e) { progress = {}; }
    }

    // 2. Merge this update
    progress[handle] = { pct, sec, at: Date.now() };

    // 3. Trim to the most recent MAX_ENTRIES
    const entries = Object.entries(progress);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      progress = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    }

    // 4. Write back
    const writeData = await shopifyGraphQL(
      `mutation Write($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        metafields: [
          {
            ownerId,
            namespace: 'custom',
            key: 'watch_progress',
            type: 'json',
            value: JSON.stringify(progress),
          },
        ],
      }
    );

    const userErrors = writeData?.metafieldsSet?.userErrors || [];
    if (userErrors.length) {
      return res.status(422).json({ error: 'metafieldsSet failed', userErrors });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('watch-progress error:', err);
    // Surface the message to the browser to speed up debugging.
    // Once it's working you can drop `detail` if you'd rather not expose it.
    return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
  }
};
