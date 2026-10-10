const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = 'kcc_shop_bot_secret_2026';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTAtj3pgbKJnhgoxx49-5HlrKs14jT1Bb-434RRDpgt4xdtCVSzD6px9dNmT-Rl8lCcV1Eb5Wh4S6Gs/pub?output=csv';

// Fetch all rows from Google Sheet
async function fetchSheetRows() {
  try {
    const response = await axios.get(SHEET_CSV_URL);
    const lines = response.data.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];

    const products = [];
    for (let i = 1; i < lines.length; i++) {
      // Split by comma while trimming quotes
      const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
      if (!cols[0]) continue;

      products.push({
        item: cols[0] || '',
        category: cols[1] || '',
        price: cols[2] || '0',
        unit: cols[3] || '',
        available: (cols[4] || 'yes').toLowerCase()
      });
    }
    return products;
  } catch (error) {
    console.error('Error fetching sheet:', error.message);
    return [];
  }
}

// Generate the full catalog
async function getProductCatalog() {
  const products = await fetchSheetRows();
  if (products.length === 0) return '🛒 *KCC Shop*\n\nCatalog is currently being updated. Please check back shortly!';

  let catalogText = '🛒 *KCC Shop - Price List*\n\n';
  let hasItems = false;

  for (const p of products) {
    // If available is empty or yes/y/available, show it
    if (!p.available || p.available === 'yes' || p.available === 'y' || p.available === 'available') {
      catalogText += `• *${p.item}* ${p.category ? `(${p.category})` : ''} - ₹${p.price} ${p.unit}\n`;
      hasItems = true;
    }
  }

  if (!hasItems) {
    // Fallback: list all items even if available flag wasn't typed as 'yes'
    for (const p of products) {
      catalogText += `• *${p.item}* ${p.category ? `(${p.category})` : ''} - ₹${p.price} ${p.unit}\n`;
    }
  }

  catalogText += '\nType the name of any item (e.g. *SMPS*) to view details or enquire!';
  return catalogText;
}

// Search for a specific item (e.g. smps, mouse, keyboard)
async function searchProduct(query) {
  const products = await fetchSheetRows();
  const q = query.toLowerCase().trim();

  const matched = products.filter(p => p.item.toLowerCase().includes(q));
  if (matched.length === 0) return null;

  let reply = `🔍 *Search Results for "${query}":*\n\n`;
  for (const p of matched) {
    reply += `📦 *${p.item}*\n`;
    if (p.category) reply += `Category: ${p.category}\n`;
    reply += `Price: ₹${p.price} ${p.unit}\n`;
    reply += `Status: ${p.available === 'no' ? '❌ Out of stock' : '✅ In stock'}\n\n`;
  }
  reply += 'To place an order or talk to our team, please send your order quantity!';
  return reply;
}

// 1. Meta Webhook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge ? challenge.toString() : '');
  }
  return res.sendStatus(403);
});

// 2. Incoming WhatsApp Message
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from;
    const text = message.text ? message.text.body.trim().toLowerCase() : '';

    console.log(`Received from ${from}: ${text}`);

    if (['hi', 'hello', 'hey', 'start'].includes(text)) {
      await sendWhatsAppMessage(from, 'Welcome to *KCC Shop*! 👋\n\n• Type *price* or *menu* to see our full rate list.\n• Or type the name of any product (like *SMPS*) to check price & stock.');
    } else if (['price', 'prices', 'rate', 'rates', 'menu', 'catalog', 'list'].some(k => text.includes(k))) {
      const catalog = await getProductCatalog();
      await sendWhatsAppMessage(from, catalog);
    } else {
      // Check if user is searching for a product in the sheet
      const productReply = await searchProduct(text);
      if (productReply) {
        await sendWhatsAppMessage(from, productReply);
      } else {
        await sendWhatsAppMessage(from, `We could not find "${text}" in our catalog.\n\nType *price* to see all available items, or message our counter directly!`);
      }
    }
  }

  res.sendStatus(200);
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
