// api/favorite.js
// Toggles a product in the logged-in customer's "custom.favorite_recipes" metafield.
// Uses a permanent offline Admin API token (from the authorization code grant).

const SHOP = process.env.SHOP_DOMAIN;          // cwlc-2.myshopify.com
const TOKEN = process.env.ADMIN_API_TOKEN;     // shpca_... token
const ALLOWED_ORIGIN = process.env.STORE_ORIGIN; // https://www.cookingwithloveclub.com
const API_VERSION = '2025-01';
const MF_NAMESPACE = 'custom';
const MF_KEY = 'favorite_recipes';

async function gql(query, variables) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
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
          metafield(namespace: "${MF_NAMESPACE}", key: "${MF_KEY}") { value }
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
          namespace: MF_NAMESPACE,
          key: MF_KEY,
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
