const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = 'kcc_shop_bot_secret_2026';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';
const ADMIN_PHONE_NUMBER = process.env.ADMIN_PHONE_NUMBER || '';

// Google Sheets CSV Export URLs
const SHEET_BASE_ID = '11IzWbS5OJ31XbvF4FT9KBJLiuu-kBDyR7oyAyGZ3XoY';
const PRODUCTS_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_BASE_ID}/export?format=csv&gid=0`;
const COURSES_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_BASE_ID}/export?format=csv&gid=1144770014`;

const processedMessages = new Set();
const userSessions = new Map();

// Dictionary for common duration & category translations to Gujarati
const gujaratiDictionary = {
  // Categories
  'keyboard': 'કીબોર્ડ',
  'mouse': 'માઉસ',
  'cables': 'કેબલ અને વાયર',
  'accessories': 'કમ્પ્યુટર એસેસરીઝ',
  'storage': 'પેનડ્રાઈવ / હાર્ડડિસ્ક',
  'general': 'સામાન્ય સાધનો',
  // Duration terms
  'month': 'મહિના',
  'months': 'મહિના',
  'year': 'વર્ષ',
  'years': 'વર્ષ',
  'days': 'દિવસ',
  'flexible': 'અનુકૂળ સમય'
};

function translateText(text) {
  if (!text) return '';
  let res = text;
  for (const [en, gu] of Object.entries(gujaratiDictionary)) {
    const reg = new RegExp(`\\b${en}\\b`, 'gi');
    res = res.replace(reg, gu);
  }
  return res;
}

// Robust CSV parser
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

// 1. Fetch Products (checks for optional Gujarati columns in col 4/5 if added)
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
      item_gu: cols[4] || item, // Uses Col E if provided in sheet, else falls back cleanly
      category: cols[1] || 'General',
      category_gu: translateText(cols[1] || 'General'),
      price: cols[2] || '0',
      available: cols[3] || 'Available'
    });
  }
  return products;
}

// 2. Fetch Courses (checks for optional Gujarati columns in col 5/6 if added)
async function fetchCourses() {
  const rows = await fetchCsvData(COURSES_CSV_URL);
  const courses = [];

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i];
    const name = cols[0];
    if (!name || name.toLowerCase().includes('course')) continue;

    const rawDuration = cols[2] || 'Flexible';
    courses.push({
      index: courses.length,
      name: name,
      name_gu: cols[5] || name, // Uses Col F if provided in sheet, else falls back
      category: cols[1] || 'General',
      duration: rawDuration,
      duration_gu: translateText(rawDuration),
      fees: cols[3] || 'Contact Us',
      highlights: cols[4] || 'Practical training & certification.',
      highlights_gu: cols[6] || cols[4] || 'પ્રેક્ટિકલ ટ્રેનિંગ અને સર્ટિફિકેટ.'
    });
  }
  return courses;
}

function getSession(from) {
  if (!userSessions.has(from)) {
    userSessions.set(from, { lang: 'gu', stage: 'idle', course: '' });
  }
  return userSessions.get(from);
}

// --- WhatsApp Interactive UI Builders ---

// Step 1: Language Selector
async function sendLanguageSelector(to) {
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: 'Kaushalya Computer Centre' },
      body: { 
        text: '🙏 *નમસ્તે! કૌશલ્ય કમ્પ્યુટર સેન્ટરમાં આપનું સ્વાગત છે.*\n' +
              'Welcome to Kaushalya Computer Centre.\n\n' +
              'કૃપા કરીને તમારી ભાષા પસંદ કરો:\n' +
              'Please select your preferred language:' 
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'lang_gu', title: 'ગુજરાતી' } },
          { type: 'reply', reply: { id: 'lang_en', title: 'English' } }
        ]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// Step 2: Main Menu
async function sendMainMenu(to, lang = 'gu') {
  const session = getSession(to);
  session.lang = lang;
  session.stage = 'idle';

  const isGu = lang === 'gu';

  const bodyText = isGu
    ? 'કૌશલ્ય કમ્પ્યુટર સેન્ટર અને KCC શોપમાં આપનું સ્વાગત છે.\n\nનીચે આપેલા વિકલ્પોમાંથી પસંદ કરો:'
    : 'Welcome to Kaushalya Computer Centre & Shop.\n\nChoose an option below to explore:';

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: 'Kaushalya Computer Centre' },
      body: { text: bodyText },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'nav_courses', title: isGu ? 'કમ્પ્યુટર કોર્સ' : 'Courses' } },
          { type: 'reply', reply: { id: 'nav_shop', title: isGu ? 'એસેસરીઝ' : 'Accessories' } },
          { type: 'reply', reply: { id: 'nav_info', title: isGu ? 'સેન્ટર માહિતી' : 'Centre Info' } }
        ]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// --- Courses Subsystem (Bilingual Output) ---

async function sendDirectCourseList(to) {
  const session = getSession(to);
  const isGu = session.lang === 'gu';
  const courses = await fetchCourses();

  if (courses.length === 0) {
    const emptyMsg = isGu 
      ? 'કોર્સ લિસ્ટ હાલમાં અપડેટ થઈ રહ્યું છે.' 
      : 'Courses list is currently being updated.';
    return sendTextMessage(to, emptyMsg);
  }

  const rows = courses.slice(0, 10).map((c) => ({
    id: `crs_idx_${c.index}`,
    title: (isGu ? c.name_gu : c.name).substring(0, 24),
    description: isGu ? `સમય: ${c.duration_gu} | ફી: ₹${c.fees}`.substring(0, 72) : `Duration: ${c.duration} | Fees: ₹${c.fees}`.substring(0, 72)
  }));

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: isGu ? 'ઉપલબ્ધ કમ્પ્યુટર કોર્સ' : 'Available Courses' },
      body: { 
        text: isGu 
          ? 'સંપૂર્ણ સિલેબસ, સમયગાળો અને ફી જોવા માટે કોર્સ પસંદ કરો:'
          : 'Select any course below to view duration, syllabus, and fee details:'
      },
      action: {
        button: isGu ? 'કોર્સ પસંદ કરો' : 'View Courses',
        sections: [{ title: isGu ? 'કોર્સ યાદી' : 'Course Offerings', rows: rows }]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

async function sendCourseDetails(to, courseIndex) {
  const session = getSession(to);
  const isGu = session.lang === 'gu';
  const courses = await fetchCourses();
  const crs = courses.find(c => c.index === parseInt(courseIndex));

  if (!crs) {
    return sendTextMessage(to, isGu ? 'કોર્સ મળ્યો નથી.' : 'Course details not found.');
  }

  const activeHighlights = isGu ? crs.highlights_gu : crs.highlights;
  const formattedHighlights = activeHighlights
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `  • ${line}`)
    .join('\n');

  const courseDisplayName = isGu ? crs.name_gu : crs.name;
  const durationDisplay = isGu ? crs.duration_gu : crs.duration;

  const cardBody = isGu
    ? `🎓 *${courseDisplayName}*\n` +
      `⏱ સમયગાળો: *${durationDisplay}*\n` +
      `💰 ફી: *₹${crs.fees}*\n\n` +
      `📋 *સિલેબસ અને વિશેષતાઓ:*\n` +
      `${formattedHighlights}\n\n` +
      `✅ સરકાર માન્ય પ્રમાણપત્ર અને ૧:૧ લેબ પ્રેક્ટિસ!`
    : `🎓 *${courseDisplayName}*\n` +
      `⏱ Duration: *${durationDisplay}*\n` +
      `💰 Fees: *₹${crs.fees}*\n\n` +
      `📋 *Syllabus & Highlights:*\n` +
      `${formattedHighlights}\n\n` +
      `✅ Govt. recognized certification & 1:1 lab practice!`;

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: courseDisplayName.substring(0, 24) },
      body: { text: cardBody },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `enq_crs_${crs.index}`, title: isGu ? 'પ્રવેશ / પૂછપરછ' : 'Enquire / Join' } },
          { type: 'reply', reply: { id: 'nav_courses', title: isGu ? 'બીજા કોર્સ' : 'More Courses' } }
        ]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// --- Shop Subsystem (Bilingual Output) ---

async function sendProductCategories(to) {
  const session = getSession(to);
  const isGu = session.lang === 'gu';
  const products = await fetchProducts();
  const categories = [...new Set(products.map(p => p.category.trim()).filter(Boolean))].slice(0, 10);

  if (categories.length === 0) {
    return sendTextMessage(to, isGu ? 'પ્રોડક્ટ્સ ઉપલબ્ધ નથી.' : 'Products list is currently being updated.');
  }

  const rows = categories.map((cat, idx) => ({
    id: `shp_cat_${idx}`,
    title: (isGu ? translateText(cat) : cat).substring(0, 24),
    description: isGu ? `${translateText(cat)} આઇટમ્સ જુઓ` : `View items in ${cat}`.substring(0, 72)
  }));

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: isGu ? 'શોપ કેટેગરી' : 'Shop Categories' },
      body: { 
        text: isGu 
          ? 'કમ્પ્યુટર સાધનો અને કિંમતો જોવા માટે કેટેગરી પસંદ કરો:' 
          : 'Select a category to view accessories and prices:' 
      },
      action: {
        button: isGu ? 'કેટેગરી પસંદ કરો' : 'Select Category',
        sections: [{ title: isGu ? 'કેટેગરીઝ' : 'Categories', rows: rows }]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

async function sendProductList(to, categoryIndex) {
  const session = getSession(to);
  const isGu = session.lang === 'gu';
  const products = await fetchProducts();
  const categories = [...new Set(products.map(p => p.category.trim()).filter(Boolean))];
  const selectedCat = categories[categoryIndex];

  if (!selectedCat) {
    return sendTextMessage(to, isGu ? 'કેટેગરી મળી નથી.' : 'Category not found.');
  }

  const matched = products.filter(p => p.category.toLowerCase() === selectedCat.toLowerCase()).slice(0, 10);

  if (matched.length === 0) {
    return sendTextMessage(to, isGu ? `કોઈ આઇટમ મળી નથી.` : `No items found under ${selectedCat}.`);
  }

  const rows = matched.map((p) => ({
    id: `shp_idx_${p.index}`,
    title: (isGu ? p.item_gu : p.item).substring(0, 24),
    description: isGu ? `કિંમત: ₹${p.price} | ઉપલબ્ધ છે` : `Price: ₹${p.price} | In Stock`.substring(0, 72)
  }));

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: (isGu ? translateText(selectedCat) : selectedCat).substring(0, 24) },
      body: { 
        text: isGu 
          ? 'વિગતો જોવા અથવા ઓર્ડર કરવા આઇટમ પસંદ કરો:' 
          : 'Choose an item for details or to place an order:' 
      },
      action: {
        button: isGu ? 'પ્રોડક્ટ પસંદ કરો' : 'Select Product',
        sections: [{ title: isGu ? 'સાધનો' : 'Items', rows: rows }]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

async function sendProductDetails(to, productIndex) {
  const session = getSession(to);
  const isGu = session.lang === 'gu';
  const products = await fetchProducts();
  const prod = products.find(p => p.index === parseInt(productIndex));

  if (!prod) {
    return sendTextMessage(to, isGu ? 'પ્રોડક્ટ મળી નથી.' : 'Product not found.');
  }

  const itemDisplayName = isGu ? prod.item_gu : prod.item;
  const categoryDisplayName = isGu ? prod.category_gu : prod.category;

  const bodyText = isGu
    ? `📦 *${itemDisplayName}*\n` +
      `• કેટેગરી: ${categoryDisplayName}\n` +
      `• કિંમત: *₹${prod.price}*\n` +
      `• સ્ટોક સ્થિતિ: ✅ ઉપલબ્ધ છે\n\n` +
      `આ આઇટમ બુક અથવા ઓર્ડર કરવા નીચે ટેપ કરો:`
    : `📦 *${itemDisplayName}*\n` +
      `• Category: ${categoryDisplayName}\n` +
      `• Price: *₹${prod.price}*\n` +
      `• Status: ✅ In Stock\n\n` +
      `Tap below to enquire or reserve this item:`;

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: itemDisplayName.substring(0, 24) },
      body: { text: bodyText },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `order_shp_${prod.index}`, title: isGu ? 'ઓર્ડર કરો' : 'Order Item' } },
          { type: 'reply', reply: { id: 'nav_shop', title: isGu ? 'બીજી આઇટમ્સ' : 'More Items' } }
        ]
      }
    }
  };
  await sendWhatsAppPayload(payload);
}

// Centre & Store Info
async function sendCentreInfo(to) {
  const session = getSession(to);
  const isGu = session.lang === 'gu';

  const info = isGu
    ? '🏢 *કૌશલ્ય કમ્પ્યુટર સેન્ટર & KCC શોપ*\n\n' +
      '📍 *સરનામું:* કપડવંજ, ગુજરાત\n' +
      '⏰ *સમય:* સવારે ૮:૦૦ થી સાંજે ૮:૦૦ (સોમવાર થી શનિવાર)\n\n' +
      '🎓 *એકેડેમી સુવિધાઓ:*\n' +
      '• ૧૦૦% પ્રેક્ટિકલ લેબ ટ્રેનિંગ અને અંગત માર્ગદર્શન\n' +
      '• સરકાર અને ISO માન્યતા પ્રાપ્ત સર્ટિફિકેટ\n' +
      '• મુખ્ય કોર્સ: CCC, ટેલી પ્રાઇમ (GST સાથે), DTP, બેઝિક કમ્પ્યુટર, હાર્ડવેર\n\n' +
      '🛒 *શોપ સુવિધાઓ:*\n' +
      '• કમ્પ્યુટર / લેપટોપ રિપેરિંગ અને સર્વિસ\n' +
      '• ઓરિજિનલ કીબોર્ડ, માઉસ, કેબલ્સ, પેનડ્રાઈવ અને એસેસરીઝ\n\n' +
      'રૂબરૂ મુલાકાત લો અથવા WhatsApp પર પૂછપરછ કરો!'
    : '🏢 *Kaushalya Computer Centre & KCC Shop*\n\n' +
      '📍 *Address:* Kapadvanj, Gujarat\n' +
      '⏰ *Centre Timings:* 8:00 AM – 8:00 PM (Mon - Sat)\n\n' +
      '🎓 *Academy Features:*\n' +
      '• 100% Practical Training & 1:1 Lab Guidance\n' +
      '• Govt. & ISO Recognized Certification\n' +
      '• Courses: CCC, Tally Prime (with GST), DTP, Programming, Hardware\n\n' +
      '🛒 *Shop Services:*\n' +
      '• Computer & Laptop Sales and Service\n' +
      '• Original Cables, Adapters, Keyboards & Accessories\n\n' +
      'Feel free to visit us or enquire here on WhatsApp!';

  await sendTextMessage(to, info);
  await sendMainMenu(to, session.lang);
}

// WhatsApp Dispatcher
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

// Incoming Message Router
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

  const session = getSession(from);

  // 1. Button / List Selection
  if (message.type === 'interactive') {
    const interactive = message.interactive;
    const buttonId = interactive.button_reply ? interactive.button_reply.id : null;
    const listId = interactive.list_reply ? interactive.list_reply.id : null;
    const actionId = buttonId || listId || '';

    console.log(`Action selected by ${from}: ${actionId}`);

    if (actionId === 'lang_gu') {
      session.lang = 'gu';
      await sendMainMenu(from, 'gu');
    } else if (actionId === 'lang_en') {
      session.lang = 'en';
      await sendMainMenu(from, 'en');
    } else if (actionId === 'nav_courses') {
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
      const courseName = crs ? (session.lang === 'gu' ? crs.name_gu : crs.name) : 'Selected Course';

      session.stage = 'awaiting_name';
      session.course = courseName;

      const promptMsg = session.lang === 'gu'
        ? `ખૂબ સરસ! તમે *${courseName}* પસંદ કર્યો છે 🎓\n\nકૃપા કરીને આગળ વધવા માટે તમારું *પૂરું નામ* નીચે ટાઇપ કરો:`
        : `Great! You have selected *${courseName}* 🎓\n\nPlease type your *Full Name* below to proceed:`;

      await sendTextMessage(from, promptMsg);
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
      const item = prod ? (session.lang === 'gu' ? prod.item_gu : prod.item) : 'this item';

      const orderPrompt = session.lang === 'gu'
        ? `✅ *${item}* માટે પૂછપરછ મળી છે.\n\nકૃપા કરીને તમારું *જરૂરી નંગ (Quantity)* લખીને મોકલો, અમે તરત જ સ્ટોક અને બિલ જણાવીશું!`
        : `✅ Inquiry received for *${item}*.\n\nPlease reply with your *required quantity*, and we will confirm stock and bill amount right away!`;

      await sendTextMessage(from, orderPrompt);
    }
    return;
  }

  // 2. Incoming Plain Text Messages
  if (message.type === 'text') {
    const text = message.text.body.trim();
    const lowerText = text.toLowerCase();

    if (session.stage === 'awaiting_name') {
      const studentName = text;
      const courseName = session.course;

      session.stage = 'idle';

      const ackMsg = session.lang === 'gu'
        ? `✅ આભાર, *${studentName}*!\n\nતમારી *${courseName}* માટેની નોંધણી સફળતાપૂર્વક થઈ ગઈ છે. કૌશલ્ય કમ્પ્યુટર સેન્ટરની ટીમ ટૂંક સમયમાં બેચ સમય અને ડેમો ક્લાસ માટે તમારો સંપર્ક કરશે.`
        : `✅ Thank you, *${studentName}*!\n\nYour enquiry for *${courseName}* has been registered successfully. Our team at Kaushalya Computer Centre will contact you shortly regarding batches and demo classes.`;

      await sendTextMessage(from, ackMsg);

      if (ADMIN_PHONE_NUMBER) {
        const adminAlert =
          `🔔 *NEW COURSE ENQUIRY!*\n\n` +
          `👤 *Name:* ${studentName}\n` +
          `📞 *Phone:* +${from}\n` +
          `🎓 *Interested Course:* ${courseName}\n` +
          `🌐 *Language:* ${session.lang === 'gu' ? 'Gujarati' : 'English'}\n` +
          `⏰ *Time:* ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

        await sendTextMessage(ADMIN_PHONE_NUMBER, adminAlert);
      }
      return;
    }

    if (['hi', 'hello', 'hey', 'start', 'menu', 'kem cho', 'નમસ્તે'].includes(lowerText)) {
      await sendLanguageSelector(from);
    } else if (['course', 'courses', 'admission', 'study', 'કોર્સ'].some(k => lowerText.includes(k))) {
      await sendDirectCourseList(from);
    } else if (['price', 'shop', 'item', 'accessory', 'accessories', 'ભાવ'].some(k => lowerText.includes(k))) {
      await sendProductCategories(from);
    } else {
      await sendLanguageSelector(from);
    }
  }
});

app.get('/', (req, res) => {
  res.send('Kaushalya Computer Centre WhatsApp Service is active!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
