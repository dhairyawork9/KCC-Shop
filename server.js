const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = 'kcc_shop_bot_secret_2026';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/11IzWbS5OJ31XbvF4FT9KBJLiuu-kBDyR7oyAyGZ3XoY/export?format=csv';

const processedMessages = new Set();

// Fetch products from Google Sheet
async function fetchSheetRows() {
  try {
    const response = await axios.get(SHEET_CSV_URL, { timeout: 6000 });
    const lines = response.data.trim().split(/\r?\n/);
    if (lines.length === 0) return [];

    const products = [];
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
      const item = cols[0] || '';
      if (!item || item.toLowerCase() === 'item') continue;

      products.push({
        id: `prod_${i}`,
        item: item,
        category: cols[1] || 'General',
        price: cols[2] || '0',
        available: cols[3] || cols[4] || 'Available'
      });
    }
    return products;
  } catch (error) {
    console.error('Error reading sheet:', error.message);
    return [];
  }
}

// 1. Send Main Menu with Quick Buttons
async function sendMainMenu(to) {
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: '🏪 Welcome to KCC Shop!' },
      body: { text: 'Choose an option below to browse our inventory or get store details:' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'btn_categories', title: '📂 Categories' } },
          { type: 'reply', reply: { id: 'btn_all_items', title: '📋 Full Price List' } },
          { type: 'reply', reply: { id: 'btn_shop_info', title: '📍 Store Info' } }
        ]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// 2. Send Category Selection List
async function sendCategoryList(to) {
  const products = await fetchSheetRows();
  const categories = [...new Set(products.map(p => p.category.trim()).filter(Boolean))].slice(0, 10);

  if (categories.length === 0) {
    return sendTextMessage(to, 'No categories available right now.');
  }

  const rows = categories.map((cat, idx) => ({
    id: `cat_${idx}_${cat.toLowerCase().replace(/\s+/g, '_')}`,
    title: cat.substring(0, 24),
    description: `View items in ${cat}`.substring(0, 72)
  }));

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: '📁 Product Categories' },
      body: { text: 'Select a category to see available items and prices:' },
      action: {
        button: 'Select Category',
        sections: [{ title: 'Categories', rows: rows }]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// 3. Send Products inside Selected Category
async function sendCategoryProducts(to, categoryName) {
  const products = await fetchSheetRows();
  const matched = products.filter(p => p.category.toLowerCase() === categoryName.toLowerCase()).slice(0, 10);

  if (matched.length === 0) {
    return sendTextMessage(to, `No items found under ${categoryName}.`);
  }

  const rows = matched.map(p => ({
    id: `item_${p.item.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20)}`,
    title: p.item.substring(0, 24),
    description: `₹${p.price} | In Stock`.substring(0, 72)
  }));

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: `📦 ${categoryName}` },
      body: { text: `Choose any item from ${categoryName} for price and ordering options:` },
      action: {
        button: 'Select Product',
        sections: [{ title: 'Items', rows: rows }]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// 4. Send Product Details with Order Button
async function sendProductDetails(to, itemNameClean) {
  const products = await fetchSheetRows();
  const clean = itemNameClean.replace(/_/g, ' ').toLowerCase();
  const prod = products.find(p => p.item.toLowerCase().includes(clean) || clean.includes(p.item.toLowerCase()));

  if (!prod) {
    return sendTextMessage(to, 'Item details not found. Please select from the menu.');
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: `📦 ${prod.item}` },
      body: { text: `• Category: ${prod.category}\n• Price: *₹${prod.price}*\n• Status: ✅ Available in store\n\nTap below to enquire or place an order!` },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `order_${prod.item}`, title: '🛒 Order / Enquire' } },
          { type: 'reply', reply: { id: 'btn_categories', title: '📂 Other Items' } }
        ]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// 5. Send Full Text Price List
async function sendFullPriceList(to) {
  const products = await fetchSheetRows();
  if (products.length === 0) {
    return sendTextMessage(to, 'Price list is being updated. Please check back shortly!');
  }

  let text = '🛒 *KCC Shop - Full Price List*\n\n';
  for (const p of products) {
    text += `• *${p.item}* (${p.category}) - ₹${p.price}\n`;
  }
  text += '\nTap *Categories* to browse and select products easily.';
  await sendTextMessage(to, text);
  await sendMainMenu(to);
}

// 6. Send Store Info
async function sendStoreInfo(to) {
  const info = '🏪 *KCC Shop*\n\n' +
    '📍 *Location:* Kapadvanj, Gujarat\n' +
    '⏰ *Timings:* 9:00 AM – 8:00 PM (Mon - Sat)\n' +
    '📞 *Contact:* Counter assistance available\n\n' +
    'We supply computer hardware, accessories, cables, and electronic components!';
  await sendTextMessage(to, info);
  await sendMainMenu(to);
}

// WhatsApp Raw Dispatcher
async function sendWhatsAppPayload(payload) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('Send error:', err.response ? err.response.data : err.message);
  }
}

async function sendTextMessage(to, text) {
  await sendWhatsAppPayload({
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: text }
  });
}

// Meta Webhook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge ? challenge.toString() : '');
  }
  return res.sendStatus(403);
});

// Incoming Messages & Button/List Clicks
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  if (!body.object || !body.entry || !body.entry[0].changes || !body.entry[0].changes[0].value.messages) {
    return;
  }

  const message = body.entry[0].changes[0].value.messages[0];
  const messageId = message.id;
  const from = message.from;

  if (processedMessages.has(messageId)) return;
  processedMessages.add(messageId);
  if (processedMessages.size > 500) {
    processedMessages.delete(processedMessages.values().next().value);
  }

  // Handle Interactive Button / List click
  if (message.type === 'interactive') {
    const interactive = message.interactive;
    const buttonId = interactive.button_reply ? interactive.button_reply.id : null;
    const listId = interactive.list_reply ? interactive.list_reply.id : null;
    const actionId = buttonId || listId || '';

    console.log(`Action selected by ${from}: ${actionId}`);

    if (actionId === 'btn_categories') {
      await sendCategoryList(from);
    } else if (actionId === 'btn_all_items') {
      await sendFullPriceList(from);
    } else if (actionId === 'btn_shop_info') {
      await sendStoreInfo(from);
    } else if (actionId.startsWith('cat_')) {
      const parts = actionId.split('_');
      const catName = parts.slice(2).join(' ');
      await sendCategoryProducts(from, catName);
    } else if (actionId.startsWith('item_')) {
      const itemKey = actionId.replace('item_', '');
      await sendProductDetails(from, itemKey);
    } else if (actionId.startsWith('order_')) {
      const orderedItem = actionId.replace('order_', '');
      await sendTextMessage(from, `✅ Thank you! We received your inquiry for *${orderedItem}*.\n\nPlease reply with your *required quantity* or questions, and our counter team will get back to you!`);
    }
    return;
  }

  // Handle plain text messages (e.g. "hi", "price", or typed product)
  if (message.type === 'text') {
    const text = message.text.body.trim().toLowerCase();

    if (['hi', 'hello', 'hey', 'start', 'menu'].includes(text)) {
      await sendMainMenu(from);
    } else if (['price', 'prices', 'rate', 'rates', 'list'].includes(text)) {
      await sendFullPriceList(from);
    } else {
      // Direct text search fallback
      await sendProductDetails(from, text);
    }
  }
});

app.get('/', (req, res) => {
  res.send('KCC Interactive WhatsApp Bot is live!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
