const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = 'kcc_shop_bot_secret_2026';

// Meta Access Token & Phone Number ID (leave as placeholders for now, we will add them from Meta)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';

// Your published Google Sheet CSV link
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTAtj3pgbKJnhgoxx49-5HlrKs14jT1Bb-434RRDpgt4xdtCVSzD6px9dNmT-Rl8lCcV1Eb5Wh4S6Gs/pub?output=csv';

// Helper: Fetch and format products from Google Sheet
async function getProductCatalog() {
  try {
    const response = await axios.get(SHEET_CSV_URL);
    const lines = response.data.trim().split('\n');
    if (lines.length <= 1) return 'No products found in the catalog right now.';

    let catalogText = '🛒 *KCC Shop - Price List*\n\n';
    // Skip header line (index 0)
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const item = cols[0] || 'Unknown';
      const category = cols[1] || '';
      const price = cols[2] || '0';
      const unit = cols[3] || '';
      const available = (cols[4] || 'yes').toLowerCase();

      if (available === 'yes' || available === 'y') {
        catalogText += `• *${item}* ${category ? `(${category})` : ''} - ₹${price} ${unit}\n`;
      }
    }
    catalogText += '\nReply with the item name to enquire or place an order!';
    return catalogText;
  } catch (error) {
    console.error('Error fetching sheet:', error.message);
    return 'Sorry, could not load current prices at this moment.';
  }
}

// 1. Meta Webhook Verification endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 2. Incoming WhatsApp Message endpoint
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from; // Customer's WhatsApp phone number
    const text = message.text ? message.text.body.trim().toLowerCase() : '';

    console.log(`Received message from ${from}: ${text}`);

    // If customer says "hi", "price", "products", "menu", or "catalog"
    if (['hi', 'hello', 'price', 'prices', 'rate', 'rates', 'menu', 'catalog', 'shop', 'list'].some(keyword => text.includes(keyword))) {
      const catalog = await getProductCatalog();
      await sendWhatsAppMessage(from, catalog);
    } else {
      await sendWhatsAppMessage(from, 'Welcome to KCC Shop! Type *price* or *menu* to see our available items and rates.');
    }
  }

  res.sendStatus(200);
});

// Helper: Send reply back to customer via Meta Cloud API
async function sendWhatsAppMessage(to, messageText) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.log('WhatsApp Token or Phone ID not set yet. Message preview:\n', messageText);
    return;
  }

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