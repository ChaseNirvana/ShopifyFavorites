// api/favorite.js
// Toggles a product in the logged-in customer's "custom.favorites" metafield.
// Uses Shopify's Client Credentials Grant (Dev Dashboard app) to get a short-lived
// access token, cached in memory and refreshed before it expires.

const SHOP = process.env.SHOP_DOMAIN;            // cookingwithloveclub.myshopify.com
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID; // from Dev Dashboard -> Settings
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const ALLOWED_ORIGIN = process.env.STORE_ORIGIN; // https://www.cookingwithloveclub.com
const API_VERSION = '2025-01';

// --- token cache (persists while the serverless instance stays warm) ---
let cachedToken = null;
let tokenExpiresAt = 0; // epoch ms

async function getAccessToken() {
  // Reuse cached token if it has >60s of life left
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 86399) * 1000;
  return cachedToken;
}

async function gql(query, variables) {
  const token = await getAccessToken();
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { customerId, productId } = req.body || {};
  if (!customerId || !productId) {
    return res.status(400).json({ error: 'Missing customerId or productId' });
  }

  const customerGid = `gid://shopify/Customer/${customerId}`;
  const productGid = `gid://shopify/Product/${productId}`;

  try {
    // 1. Read current favorites
    const read = await gql(
      `query($id: ID!) {
        customer(id: $id) {
          metafield(namespace: "custom", key: "favorites") { value }
        }
      }`,
      { id: customerGid }
    );

    if (read.errors) {
      return res.status(500).json({ error: 'Read failed', detail: read.errors });
    }

    let favs = [];
    const raw = read.data?.customer?.metafield?.value;
    if (raw) {
      try { favs = JSON.parse(raw); } catch { favs = []; }
    }

    // 2. Toggle
    const active = !favs.includes(productGid);
    favs = active
      ? [...favs, productGid]
      : favs.filter((id) => id !== productGid);

    // 3. Write back the full list
    const write = await gql(
      `mutation($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        metafields: [{
          ownerId: customerGid,
          namespace: 'custom',
          key: 'favorites',
          type: 'list.product_reference',
          value: JSON.stringify(favs),
        }],
      }
    );

    const userErrors = write.data?.metafieldsSet?.userErrors || [];
    if (userErrors.length) {
      return res.status(500).json({ error: 'Write failed', detail: userErrors });
    }

    return res.status(200).json({ active, count: favs.length });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', detail: String(err) });
  }
}
