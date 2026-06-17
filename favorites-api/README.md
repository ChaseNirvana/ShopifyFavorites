# Favorites API (Shopify customer metafield toggle)

A tiny Vercel serverless function that adds/removes a product from a logged-in
customer's `custom.favorites` metafield when they click a favorite button.

---

## What this does

When a customer clicks the ♥ button on a product page, the storefront sends the
customer ID and product ID to this function. The function reads their current
favorites list, adds or removes the product, and saves it back to Shopify.

---

## Setup (one-time, ~15 minutes)

### 1. Create the metafield definition (in Shopify admin)

1. Go to **Settings → Custom data → Customers**
2. Click **Add definition**
3. Name: `Favorites`
4. Namespace and key: `custom.favorites`
5. Type: **Product** → select **List of products**
6. Save

### 2. Create a custom app + get the Admin API token (in Shopify admin)

1. Go to **Settings → Apps and sales channels → Develop apps**
2. Click **Allow custom app development** (if prompted), then **Create an app**
3. Name it e.g. `Favorites Backend`
4. Open **Configuration → Admin API integration → Configure**
5. Under **Admin API access scopes**, enable:
   - `read_customers`
   - `write_customers`
6. Save, then go to **API credentials → Install app**
7. Copy the **Admin API access token** (starts with `shpat_...`).
   ⚠️ You only see this once — copy it now.

### 3. Deploy to Vercel

1. Create a free account at https://vercel.com
2. Install the CLI: `npm i -g vercel`
3. From this folder, run: `vercel`
   (accept defaults; it deploys to a project on your account)
4. Run `vercel --prod` to get the production URL.
   It will look like `https://favorites-api-xxxx.vercel.app`

### 4. Add environment variables (in Vercel dashboard)

Project → **Settings → Environment Variables**. Add these three:

| Name              | Value (example)                          |
|-------------------|------------------------------------------|
| `SHOP_DOMAIN`     | `cookingwithloveclub.myshopify.com`      |
| `ADMIN_API_TOKEN` | `shpat_...` (from step 2)                |
| `STORE_ORIGIN`    | `https://www.cookingwithloveclub.com`    |

Redeploy after adding them: `vercel --prod`

### 5. Add the button to the product template (in your theme)

In `sections/main-product.liquid` (or wherever you want the button), paste the
snippet from `theme-snippet.liquid` in this repo. **Update the `FAVORITES_API`
URL** to your Vercel production URL.

---

## Security note

This version passes `customer.id` directly from the storefront, so the customer
ID is technically client-supplied. For a free-recipe favorites feature this is
fine. If you later need it hardened (so one customer can't favorite items on
another's account), switch to a Shopify App Proxy in front of this endpoint so
Shopify supplies a verified `logged_in_customer_id`.

---

## Files

- `api/favorite.js` — the serverless function (the whole backend)
- `theme-snippet.liquid` — button + JS to paste into the theme
- `package.json` — tells Vercel this is a Node project
