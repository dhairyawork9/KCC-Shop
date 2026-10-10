const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = 'kcc_shop_bot_secret_2026';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';

// Direct real-time CSV export link using your sheet ID
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/11IzWbS5OJ31XbvF4FT9KBJLiuu-kBDyR7oyAyGZ3XoY/export?format=csv';

// Fetch rows directly from your sheet
async function fetchSheetRows() {
  try {
    const response = await axios.get(SHEET_CSV_URL);
    const lines = response.data.trim().split(/\r?\n/);
    if (lines.length === 0) return [];

    const products = [];
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
      const item = cols[0] || '';
      
      // Ignore header row if present
      if (item.toLowerCase() === 'item') continue;
      if (!item) continue;

      products.push({
        item: item,
        category: cols[1] || '',
        price: cols[2] || '0',
        available: cols[3] || cols[4] || 'Available'
      });
    }
    return products;
  } catch (error) {
    console.error('Error fetching sheet:', error.message);
    return [];
  }
}

// Generate catalog text
async function getProductCatalog() {
  const products = await fetchSheetRows();
  if (products.length === 0) {
    return '🛒 *KCC Shop*\n\nCatalog is being refreshed. Please try again in a moment!';
  }

  let catalogText = '🛒 *KCC Shop - Price List*\n\n';
  for (const p of products) {
    catalogText += `• *${p.item}* ${p.category ? `(${p.category})` : ''} - ₹${p.price}\n`;
  }
  catalogText += '\nType any product name (e.g. *smps*, *keyboard*) to check details or place an order!';
  return catalogText;
}

// Search for a specific item
async function searchProduct(query) {
  const products = await fetchSheetRows();
  const q = query.toLowerCase().trim();

  const matched = products.filter(p => p.item.toLowerCase().includes(q));
  if (matched.length === 0) return null;

  let reply = `🔍 *Search Results for "${query}":*\n\n`;
  for (const p of matched) {
    reply += `📦 *${p.item}*\n`;
    if (p.category) reply += `Category: ${p.category}\n`;
    reply += `Price: ₹${p.price}\n`;
    reply += `Status: ✅ In Stock\n\n`;
  }
  reply += 'To place an order, reply with your required quantity!';
  return reply;
}

// Webhook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge ? challenge.toString() : '');
  }
  return res.sendStatus(403);
});

// WhatsApp Messages Endpoint
app.post('/webhook', async response => {
  const body = response.body;

  if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from;
    const text = message.text ? message.text.body.trim().toLowerCase() : '';

    console.log(`Received from ${from}: ${text}`);

    if (['hi', 'hello', 'hey', 'start'].includes(text)) {
      await sendWhatsAppMessage(from, 'Welcome to *KCC Shop*! 👋\n\n• Type *price* or *menu* to view our rate list.\n• Or type the name of any item (like *smps* or *cell*) to check price.');
    } else if (['price', 'prices', 'rate', 'rates', 'menu', 'catalog', 'list'].some(k => text.includes(k))) {
      const catalog = await getProductCatalog();
      await sendWhatsAppMessage(from, catalog);
    } else {
      const productReply = await searchProduct(text);
      if (productReply) {
        await sendWhatsAppMessage(from, productReply);
      } else {
        await sendWhatsAppMessage(from, `We could not find "${text}" in our catalog.\n\nType *price* to see all items!`);
      }
    }
  }

  response.sendStatus(200);
});

async function sendWhatsAppMessage(to, messageText) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return;

  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        text: { body: messageText }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('Error sending message:', err.response ? err.response.data : err.message);
  }
}

app.get('/', (req, res) => {
  res.send('KCC WhatsApp Bot is online and running!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
