const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = 'kcc_shop_bot_secret_2026';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';
// Admin number to receive alerts (e.g., 9198XXXXXXXX)
const ADMIN_PHONE_NUMBER = process.env.ADMIN_PHONE_NUMBER || '';

// Google Sheets CSV Export URLs
const SHEET_BASE_ID = '11IzWbS5OJ31XbvF4FT9KBJLiuu-kBDyR7oyAyGZ3XoY';
const PRODUCTS_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_BASE_ID}/export?format=csv&gid=0`;
const COURSES_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_BASE_ID}/export?format=csv&gid=1144770014`;

const processedMessages = new Set();
// User session state: tracks pending course inquiries { [phoneNumber]: { stage: 'awaiting_name', course: 'CCC' } }
const userSessions = new Map();

// Robust CSV parser supporting quotes, commas, and internal newlines
function parseCsv(text) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some(col => col.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(col => col.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

async function fetchCsvData(url) {
  try {
    const response = await axios.get(url, { timeout: 6000 });
    return parseCsv(response.data);
  } catch (err) {
    console.error(`Error reading ${url}:`, err.message);
    return [];
  }
}

// 1. Fetch Products
async function fetchProducts() {
  const rows = await fetchCsvData(PRODUCTS_CSV_URL);
  const products = [];

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i];
    const item = cols[0];
    if (!item || item.toLowerCase() === 'item') continue;

    products.push({
      index: products.length,
      item: item,
      category: cols[1] || 'General',
      price: cols[2] || '0',
      available: cols[3] || cols[4] || 'Available'
    });
  }
  return products;
}

// 2. Fetch Courses
async function fetchCourses() {
  const rows = await fetchCsvData(COURSES_CSV_URL);
  const courses = [];

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i];
    const name = cols[0];
    if (!name || name.toLowerCase().includes('course')) continue;

    courses.push({
      index: courses.length,
      name: name,
      category: cols[1] || 'General',
      duration: cols[2] || 'Flexible',
      fees: cols[3] || 'Contact Us',
      highlights: cols[4] || 'Practical training & certification.'
    });
  }
  return courses;
}

// Main Welcome Menu
async function sendMainMenu(to) {
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: 'Kaushalya Computer Centre' },
      body: { text: 'Welcome! We offer certified computer courses & hardware accessories.\n\nChoose an option below to explore:' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'nav_courses', title: 'Courses' } },
          { type: 'reply', reply: { id: 'nav_shop', title: 'Accessories' } },
          { type: 'reply', reply: { id: 'nav_info', title: 'Centre Info' } }
        ]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// Direct Course List
async function sendDirectCourseList(to) {
  const courses = await fetchCourses();

  if (courses.length === 0) {
    return sendTextMessage(to, 'Courses list is currently being updated. Please check back shortly!');
  }

  const rows = courses.slice(0, 10).map((c) => ({
    id: `crs_idx_${c.index}`,
    title: c.name.substring(0, 24),
    description: `${c.duration} | Fees: ₹${c.fees}`.substring(0, 72)
  }));

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Available Courses' },
      body: { text: 'Select any course below to view duration, syllabus, and fee details:' },
      action: {
        button: 'View Courses',
        sections: [{ title: 'Course Offerings', rows: rows }]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// Course Details Card
async function sendCourseDetails(to, courseIndex) {
  const courses = await fetchCourses();
  const crs = courses.find(c => c.index === parseInt(courseIndex));

  if (!crs) {
    return sendTextMessage(to, 'Course details not found. Please browse from the menu.');
  }

  const formattedHighlights = crs.highlights
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `  • ${line}`)
    .join('\n');

  const cardBody = 
    `🎓 *${crs.name}*\n` +
    `⏱ Duration: *${crs.duration}*\n` +
    `💰 Fees: *₹${crs.fees}*\n\n` +
    `📋 *Syllabus & Highlights:*\n` +
    `${formattedHighlights}\n\n` +
    `Govt. recognized certification & 1:1 lab practice!`;

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: crs.name.substring(0, 24) },
      body: { text: cardBody },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `enq_crs_${crs.index}`, title: 'Enquire / Join' } },
          { type: 'reply', reply: { id: 'nav_courses', title: 'More Courses' } }
        ]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// Shop Subsystem
async function sendProductCategories(to) {
  const products = await fetchProducts();
  const categories = [...new Set(products.map(p => p.category.trim()).filter(Boolean))].slice(0, 10);

  if (categories.length === 0) {
    return sendTextMessage(to, 'Products list is currently being updated.');
  }

  const rows = categories.map((cat, idx) => ({
    id: `shp_cat_${idx}`,
    title: cat.substring(0, 24),
    description: `View items in ${cat}`.substring(0, 72)
  }));

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Shop Categories' },
      body: { text: 'Select a category to view accessories and prices:' },
      action: {
        button: 'Select Category',
        sections: [{ title: 'Categories', rows: rows }]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

async function sendProductList(to, categoryIndex) {
  const products = await fetchProducts();
  const categories = [...new Set(products.map(p => p.category.trim()).filter(Boolean))];
  const selectedCat = categories[categoryIndex];

  if (!selectedCat) {
    return sendTextMessage(to, 'Category not found. Please select from the menu.');
  }

  const matched = products.filter(p => p.category.toLowerCase() === selectedCat.toLowerCase()).slice(0, 10);

  if (matched.length === 0) {
    return sendTextMessage(to, `No items found under ${selectedCat}.`);
  }

  const rows = matched.map((p) => ({
    id: `shp_idx_${p.index}`,
    title: p.item.substring(0, 24),
    description: `₹${p.price} | In Stock`.substring(0, 72)
  }));

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: selectedCat.substring(0, 24) },
      body: { text: 'Choose an item for details or to place an order:' },
      action: {
        button: 'Select Product',
        sections: [{ title: 'Items', rows: rows }]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

async function sendProductDetails(to, productIndex) {
  const products = await fetchProducts();
  const prod = products.find(p => p.index === parseInt(productIndex));

  if (!prod) {
    return sendTextMessage(to, 'Product not found. Please choose from our catalog.');
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: prod.item.substring(0, 24) },
      body: { text: `• Category: ${prod.category}\n• Price: *₹${prod.price}*\n• Status: ✅ In Stock\n\nTap below to enquire or reserve this item!` },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `order_shp_${prod.index}`, title: 'Order Item' } },
          { type: 'reply', reply: { id: 'nav_shop', title: 'More Items' } }
        ]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

async function sendCentreInfo(to) {
  const info = '🏢 *Kaushalya Computer Centre & KCC Shop*\n\n' +
    '📍 *Address:* Kapadvanj, Gujarat\n' +
    '⏰ *Centre Timings:* 8:00 AM – 8:00 PM (Mon - Sat)\n\n' +
    '🎓 *Academy Features:*\n' +
    '• 100% Practical Training & 1:1 Lab Guidance\n' +
    '• Govt. & ISO Recognized Certification\n' +
    '• Courses: CCC, Tally Prime, DTP, Programming, Hardware\n\n' +
    '🛒 *Shop Services:*\n' +
    '• Computer & Laptop Sales and Service\n' +
    '• Original Cables, Adapters, Keyboards & Accessories\n\n' +
    'Feel free to visit us or enquire here on WhatsApp!';
  await sendTextMessage(to, info);
  await sendMainMenu(to);
}

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
    console.error('Send error:', err.response ? JSON.stringify(err.response.data) : err.message);
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

// Incoming Message / Interaction Router
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

  // 1. Interactive Button / List Clicks
  if (message.type === 'interactive') {
    const interactive = message.interactive;
    const buttonId = interactive.button_reply ? interactive.button_reply.id : null;
    const listId = interactive.list_reply ? interactive.list_reply.id : null;
    const actionId = buttonId || listId || '';

    console.log(`Action selected by ${from}: ${actionId}`);

    if (actionId === 'nav_courses') {
      await sendDirectCourseList(from);
    } else if (actionId === 'nav_shop') {
      await sendProductCategories(from);
    } else if (actionId === 'nav_info') {
      await sendCentreInfo(from);
    } else if (actionId.startsWith('crs_idx_')) {
      const crsIdx = parseInt(actionId.replace('crs_idx_', ''));
      await sendCourseDetails(from, crsIdx);
    } else if (actionId.startsWith('enq_crs_')) {
      const crsIdx = parseInt(actionId.replace('enq_crs_', ''));
      const courses = await fetchCourses();
      const crs = courses.find(c => c.index === crsIdx);
      const courseName = crs ? crs.name : 'Selected Course';

      // Store stage in session and ask for customer name
      userSessions.set(from, { stage: 'awaiting_name', course: courseName });

      await sendTextMessage(
        from,
        `Great! You have selected *${courseName}* 🎓\n\nPlease type your *Full Name* below to proceed:`
      );
    } else if (actionId.startsWith('shp_cat_')) {
      const catIdx = parseInt(actionId.replace('shp_cat_', ''));
      await sendProductList(from, catIdx);
    } else if (actionId.startsWith('shp_idx_')) {
      const prodIdx = parseInt(actionId.replace('shp_idx_', ''));
      await sendProductDetails(from, prodIdx);
    } else if (actionId.startsWith('order_shp_')) {
      const prodIdx = parseInt(actionId.replace('order_shp_', ''));
      const products = await fetchProducts();
      const prod = products.find(p => p.index === prodIdx);
      const item = prod ? prod.item : 'this item';
      await sendTextMessage(from, `✅ Inquiry received for *${item}*.\n\nPlease reply with your *required quantity*, and we will confirm stock and bill amount right away!`);
    }
    return;
  }

  // 2. Incoming Plain Text Messages
  if (message.type === 'text') {
    const text = message.text.body.trim();
    const lowerText = text.toLowerCase();

    // Check if user is in "awaiting_name" stage
    const session = userSessions.get(from);
    if (session && session.stage === 'awaiting_name') {
      const studentName = text;
      const courseName = session.course;

      // Clear session after capturing
      userSessions.delete(from);

      // Reply to student
      await sendTextMessage(
        from,
        `✅ Thank you, *${studentName}*!\n\nYour enquiry for *${courseName}* has been registered successfully. Our team at Kaushalya Computer Centre will contact you shortly regarding batches and demo classes.`
      );

      // Forward lead notification to Admin WhatsApp number
      if (ADMIN_PHONE_NUMBER) {
        const adminAlert =
          `🔔 *NEW COURSE ENQUIRY!*\n\n` +
          `👤 *Name:* ${studentName}\n` +
          `📞 *Phone:* +${from}\n` +
          `🎓 *Interested Course:* ${courseName}\n` +
          `⏰ *Time:* ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

        await sendTextMessage(ADMIN_PHONE_NUMBER, adminAlert);
      }
      return;
    }

    // Default Navigation Responses
    if (['hi', 'hello', 'hey', 'start', 'menu'].includes(lowerText)) {
      await sendMainMenu(from);
    } else if (['course', 'courses', 'admission', 'study'].some(k => lowerText.includes(k))) {
      await sendDirectCourseList(from);
    } else if (['price', 'shop', 'item', 'accessory', 'accessories'].some(k => lowerText.includes(k))) {
      await sendProductCategories(from);
    } else {
      await sendMainMenu(from);
    }
  }
});

app.get('/', (req, res) => {
  res.send('Kaushalya Computer Centre WhatsApp Service is active!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
