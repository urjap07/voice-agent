require('dotenv').config();

const verifiedSessions = new Map();
const voiceSessionHints = new Map();
const express = require('express');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));
app.use(express.json());

function cleanPhoneNumber(phoneVal) {
    if (!phoneVal) return '';
    return String(phoneVal).replace(/\D/g, '').replace(/^91/, '').slice(-10);
}

async function lookupRegisteredUserByPhone(phoneVal) {
    const cleaned = cleanPhoneNumber(phoneVal);
    console.log(`[DB Lookup] Input="${phoneVal}" → cleaned="${cleaned}" (len=${cleaned.length})`);
    if (cleaned.length !== 10) return null;

    const { getPool } = require('./lib/db');
    const [rows] = await getPool().query(
        `SELECT user_id, phone, name, centre_name
         FROM registered_users
         WHERE phone = ? OR RIGHT(phone, 10) = ? LIMIT 1`,
        [cleaned, cleaned]
    );

    console.log(`[DB Lookup] Found ${rows.length} row(s) for "${cleaned}"`);
    return rows[0] || null;
}

function cacheVerifiedSession(sessionId, user) {
    if (!sessionId || !user) return;
    verifiedSessions.set(sessionId, {
        verified: true,
        user_id: user.user_id,
        name: user.name,
        centre_name: user.centre_name,
        phone: user.phone
    });
}

function parseNaturalDateRange(input) {
    if (!input) return null;

    // Gujarati compound number words → digits (for spoken date ranges)
    const gujaratiNumberWords = {
        'દસ': '10', 'અગિયાર': '11', 'બાર': '12', 'તેર': '13', 'ચૌદ': '14',
        'પંદર': '15', 'સોળ': '16', 'સત્તર': '17', 'અઢાર': '18', 'ઓગણીસ': '19',
        'વીસ': '20', 'એકવીસ': '21', 'બાવીસ': '22', 'ત્રેવીસ': '23', 'ચોવીસ': '24',
        'પચ્ચીસ': '25', 'છવ્વીસ': '26', 'સત્તાવીસ': '27', 'અઠ્ઠાવીસ': '28',
        'ઓગણત્રીસ': '29', 'ત્રીસ': '30', 'એકત્રીસ': '31',
        // Devanagari compound numbers (Whisper sometimes outputs these for Gujarati audio)
        'दस': '10', 'ग्यारह': '11', 'बारह': '12', 'तेरह': '13', 'चौदह': '14',
        'पंद्रह': '15', 'सोलह': '16', 'सत्रह': '17', 'अठारह': '18', 'उन्नीस': '19',
        'बीस': '20', 'इक्कीस': '21', 'बाईस': '22', 'तेईस': '23', 'चौबीस': '24',
        'पच्चीस': '25', 'छब्बीस': '26', 'सत्ताईस': '27', 'अट्ठाईस': '28',
        'उनतीस': '29', 'तीस': '30', 'इकतीस': '31',
    };

    const digitMap = { '૦': '0', '૧': '1', '૨': '2', '૩': '3', '૪': '4', '૫': '5', '૬': '6', '૭': '7', '૮': '8', '૯': '9' };
    let cleanInput = String(input).trim()
        .replace(/[૦-૯]/g, char => digitMap[char])
        .replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ');

    // Replace compound number words before digit extraction
    for (const [word, digit] of Object.entries(gujaratiNumberWords)) {
        cleanInput = cleanInput.split(word).join(digit);
    }

    const currentYear = 2026;
    const monthMap = {
        january: 1, jan: 1, 'જાન્યુઆરી': 1,
        february: 2, feb: 2, 'ફેબ્રુઆરી': 2,
        march: 3, mar: 3, 'માર્ચ': 3,
        april: 4, apr: 4, 'એપ્રિલ': 4,
        may: 5, 'મે': 5,
        june: 6, jun: 6, 'જૂન': 6, 'june': 6,
        july: 7, jul: 7, 'જુલાઈ': 7, 'જુલાઇ': 7,
        august: 8, aug: 8, 'ઓગસ્ટ': 8, 'ઑગસ્ટ': 8,
        september: 9, sep: 9, sept: 9, 'સપ્ટેમ્બર': 9,
        october: 10, oct: 10, 'ઓક્ટોબર': 10,
        november: 11, nov: 11, 'નવેમ્બર': 11,
        december: 12, dec: 12, 'ડિસેમ્બર': 12
    };
    const monthToken = '[a-zA-Z\\u0A80-\\u0AFF]+';
    const separator = '(?:to|from|through|through|-|–|—|\\bthee\\b|\\btha\\b|\\bthi\\b|\\bto\\b|થી|સુધી|અને|ane)';

    const formatDateObj = (dateObj) => {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const makeDate = (year, month, day) => {
        const y = Number(year), m = Number(month), d = Number(day);
        if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
        const dateObj = new Date(y, m - 1, d);
        if (dateObj.getFullYear() !== y || dateObj.getMonth() !== m - 1 || dateObj.getDate() !== d) return null;
        return dateObj;
    };

    const parseMonth = (monthName) => monthMap[String(monthName || '').toLowerCase().trim()];
    const buildResult = (startDateObj, endDateObj) => {
        if (!startDateObj || !endDateObj) return null;
        return { start: formatDateObj(startDateObj), end: formatDateObj(endDateObj) };
    };

    // 1. ISO format: 2026-06-11 to 2026-06-13
    const isoMatches = [...cleanInput.matchAll(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g)];
    if (isoMatches.length >= 2) {
        return buildResult(
            makeDate(isoMatches[0][1], isoMatches[0][2], isoMatches[0][3]),
            makeDate(isoMatches[1][1], isoMatches[1][2], isoMatches[1][3])
        );
    }

    // 2. DD/MM/YYYY to DD/MM/YYYY  (Indian format)
    const dmyMatches = [...cleanInput.matchAll(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/g)];
    if (dmyMatches.length >= 2) {
        return buildResult(
            makeDate(dmyMatches[0][3], dmyMatches[0][2], dmyMatches[0][1]),
            makeDate(dmyMatches[1][3], dmyMatches[1][2], dmyMatches[1][1])
        );
    }

    // 3. "11 June 2026 to 13 June 2026"  (full range, both dates have month)
    const fullRangeRegex = new RegExp(`(\\d{1,2})\\s*(${monthToken})\\s*(\\d{4})?\\s*${separator}\\s*(\\d{1,2})\\s*(${monthToken})\\s*(\\d{4})?`, 'i');
    const fullRangeMatch = cleanInput.match(fullRangeRegex);
    if (fullRangeMatch) {
        const year = fullRangeMatch[6] || fullRangeMatch[3] || currentYear;
        const m1 = parseMonth(fullRangeMatch[2]);
        const m2 = parseMonth(fullRangeMatch[5]);
        if (m1 && m2) {
            return buildResult(
                makeDate(year, m1, fullRangeMatch[1]),
                makeDate(year, m2, fullRangeMatch[4])
            );
        }
    }

    // 4. "June 11 to June 13"  (month before day)
    const monthFirstRangeRegex = new RegExp(`(${monthToken})\\s*(\\d{1,2})\\s*(?:,\\s*\\d{4})?\\s*${separator}\\s*(${monthToken})\\s*(\\d{1,2})\\s*(?:,\\s*(\\d{4}))?`, 'i');
    const monthFirstMatch = cleanInput.match(monthFirstRangeRegex);
    if (monthFirstMatch) {
        const year = monthFirstMatch[5] || currentYear;
        const m1 = parseMonth(monthFirstMatch[1]);
        const m2 = parseMonth(monthFirstMatch[3]);
        if (m1 && m2) {
            return buildResult(makeDate(year, m1, monthFirstMatch[2]), makeDate(year, m2, monthFirstMatch[4]));
        }
        // Same month: "June 11 to 13"
        const sameMonthFirst = new RegExp(`(${monthToken})\\s*(\\d{1,2})\\s*${separator}\\s*(\\d{1,2})\\s*(?:,?\\s*(\\d{4}))?`, 'i');
        const sfm = cleanInput.match(sameMonthFirst);
        if (sfm) {
            const mo = parseMonth(sfm[1]);
            const yr = sfm[4] || currentYear;
            if (mo) return buildResult(makeDate(yr, mo, sfm[2]), makeDate(yr, mo, sfm[3]));
        }
    }

    // 5. "11 - 13 June 2026"  (compact range, shared month at end)
    const compactRangeRegex = new RegExp(`(\\d{1,2})\\s*${separator}\\s*(\\d{1,2})\\s*(${monthToken})\\s*(\\d{4})?`, 'i');
    const compactRangeMatch = cleanInput.match(compactRangeRegex);
    if (compactRangeMatch) {
        const year = compactRangeMatch[4] || currentYear;
        const month = parseMonth(compactRangeMatch[3]);
        if (month) {
            return buildResult(
                makeDate(year, month, compactRangeMatch[1]),
                makeDate(year, month, compactRangeMatch[2])
            );
        }
    }

    // 6. "ચેક-ઇન 11 June અને ચેક-આઉટ 13 June"  (explicit check-in/check-out labels)
    const checkinOutRegex = new RegExp(`(?:check.?in|ચેક.?ઇ[નં]|checkin)[^\\d]*(\\d{1,2})\\s*(${monthToken})\\s*(\\d{4})?.*?(?:check.?out|ચેક.?આઉ|checkout)[^\\d]*(\\d{1,2})\\s*(${monthToken})\\s*(\\d{4})?`, 'i');
    const cicoMatch = cleanInput.match(checkinOutRegex);
    if (cicoMatch) {
        const year = cicoMatch[6] || cicoMatch[3] || currentYear;
        const m1 = parseMonth(cicoMatch[2]);
        const m2 = parseMonth(cicoMatch[5]);
        if (m1 && m2) return buildResult(makeDate(year, m1, cicoMatch[1]), makeDate(year, m2, cicoMatch[4]));
    }

    // 7. Single date fallback (treat as 1-night stay)
    const singleRegex = new RegExp(`(\\d{1,2})\\s*(${monthToken})\\s*(\\d{4})?`, 'i');
    const singleMatch = cleanInput.match(singleRegex);
    if (singleMatch && parseMonth(singleMatch[2])) {
        const startDateObj = makeDate(singleMatch[3] || currentYear, parseMonth(singleMatch[2]), singleMatch[1]);
        if (startDateObj) {
            const endDateObj = new Date(startDateObj);
            endDateObj.setDate(startDateObj.getDate() + 1);
            return buildResult(startDateObj, endDateObj);
        }
    }

    return null;
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
    try {
        const { getPool } = require('./lib/db');
        await getPool().query('SELECT 1');
        res.json({ ok: true, database: process.env.DB_NAME || 'booking_system' });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── LIST BOOKINGS ─────────────────────────────────────────────────────────────
app.get('/api/bookings', async (req, res) => {
    try {
        const { getPool } = require('./lib/db');
        const [rows] = await getPool().query(
            'SELECT * FROM bookings ORDER BY booking_id DESC LIMIT 20'
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── MANUAL CHAT BOOKING ───────────────────────────────────────────────────────
app.post('/api/bookings/manual', async (req, res) => {
    const booking = req.body;
    try {
        const { getPool } = require('./lib/db');
        const [result] = await getPool().execute(
            `INSERT INTO bookings (mumukshu_name, mumukshu_phone, start_date, end_date, has_breakfast, has_lunch, has_dinner, dietary_preference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                booking.mumukshu_name, booking.mumukshu_phone, booking.start_date, booking.end_date,
                booking.has_breakfast ? 1 : 0, booking.has_lunch ? 1 : 0, booking.has_dinner ? 1 : 0,
                booking.dietary_preference || 'Regular'
            ]
        );
        res.json({ saved: true, booking_id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── VERIFY REGISTERED PHONE ───────────────────────────────────────────────────
app.post('/verify-phone', async (req, res) => {
    const { phone } = req.body;
    try {
        const user = await lookupRegisteredUserByPhone(phone);
        if (!user) return res.json({ found: false });
        res.json({ found: true, name: user.name, centre_name: user.centre_name });
    } catch (err) {
        res.status(500).json({ found: false, error: err.message });
    }
});

// ── API VERIFY PHONE (FOR N8N CUSTOM TOOL) ───────────────────────────────────
// ── API VERIFY PHONE (FOR N8N CUSTOM TOOL) ───────────────────────────────────
// ── API VERIFY PHONE (Optimized for Voice Agent) ───────────────────────────
app.post('/api/verify-phone', async (req, res) => {
    try {
        const phoneVal = req.body.phone_number || req.body.phone;
        if (!phoneVal) return res.json({ found: false, error: 'Phone required' });

        const user = await lookupRegisteredUserByPhone(phoneVal);
        if (!user) {
            return res.json({ found: false });
        }

        // Cache for the UI Live Preview
        if (req.body.sessionId) {
            cacheVerifiedSession(req.body.sessionId, user);
        }

        // Return flat JSON structure for the n8n AI Agent
        return res.json({
            found: true,
            name: user.name,
            centre_name: user.centre_name,
            phone: user.phone
        });

    } catch (err) {
        console.error('[API VERIFY PHONE ERROR]', err);
        return res.status(500).json({ found: false, error: err.message });
    }
});

// ── GET VOICE SESSION STATUS (Used by UI) ──────────────────────────────────
// ── GET VOICE SESSION STATUS (Used by UI) ──────────────────────────────────
app.get('/api/voice-session-status', (req, res) => {
    // 1. Extract sessionId from the request query
    const { sessionId } = req.query;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    let sessionInfo = null;

    // 2. Check the memory cache
    if (verifiedSessions.has(sessionId)) {
        sessionInfo = verifiedSessions.get(sessionId);
    } else {
        // 3. NOW call the helper function with the defined sessionId
        const dbVerified = getVerifiedUserFromSession(sessionId);
        if (dbVerified) {
            verifiedSessions.set(sessionId, dbVerified);
            sessionInfo = dbVerified;
        }
    }

    if (sessionInfo && sessionInfo.verified) {
        return res.json({
            verified: true,
            name: sessionInfo.name,
            centre_name: sessionInfo.centre_name,
            phone: sessionInfo.phone,
            identity: {
                verified: 'true',
                name: sessionInfo.name,
                centre_name: sessionInfo.centre_name,
                phone: sessionInfo.phone
            }
        });
    }

    return res.json({
        verified: false,
        identity: {
            verified: 'false'
        }
    });
});

// ── API SAVE BOOKING (FOR N8N CUSTOM TOOL) ───────────────────────────────────
app.post('/api/save-booking', async (req, res) => {
    const b = req.body;

    // Resolve name/phone from verified session so AI hallucinations can't corrupt the record
    const sessionId = b.sessionId || req.query.sessionId;
    let mumukshuName = b.mumukshu_name;
    let mumukshuPhone = b.mumukshu_phone;
    if (sessionId && verifiedSessions.has(sessionId)) {
        const sess = verifiedSessions.get(sessionId);
        mumukshuName = sess.name || mumukshuName;
        mumukshuPhone = sess.phone || mumukshuPhone;
        console.log(`[SaveBooking] Using session data for ${sessionId}: name="${mumukshuName}", phone="${mumukshuPhone}"`);
    } else {
        console.log(`[SaveBooking] No session found for sessionId="${sessionId}", using AI-provided values`);
    }

    try {
        const { getPool } = require('./lib/db');
        const [result] = await getPool().execute(
            `INSERT INTO bookings (
                mumukshu_name, mumukshu_phone, start_date, end_date, total_persons,
                wants_room, floor_preference, booked_shibir,
                has_breakfast, has_lunch, has_dinner, dietary_preference
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                mumukshuName,
                mumukshuPhone,
                b.start_date,
                b.end_date,
                b.total_persons !== undefined ? parseInt(b.total_persons, 10) : 1,
                b.wants_room ? 1 : 0,
                b.floor_preference || null,
                b.booked_shibir || null,
                b.has_breakfast ? 1 : 0,
                b.has_lunch ? 1 : 0,
                b.has_dinner ? 1 : 0,
                b.dietary_preference || 'Regular'
            ]
        );
        res.json({ saved: true, booking_id: result.insertId });
    } catch (err) {
        res.status(500).json({ saved: false, error: err.message });
    }
});

// ── HELPER: CREATE SILENT WAV ────────────────────────────────────────────────
function createSilentWav() {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const duration = 0.5;
    const dataSize = sampleRate * duration * numChannels * (bitsPerSample / 8);
    const fileSize = 36 + dataSize;

    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(fileSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
}

// ── HELPER: OPENAI TTS ───────────────────────────────────────────────────────
async function generateOpenAITts(text) {
    try {
        console.log(`[OpenAI TTS] Generating TTS for text: "${text.substring(0, 80)}..."`);
        const response = await axios.post('https://api.openai.com/v1/audio/speech', {
            model: 'tts-1',
            input: text,
            voice: 'nova',
            response_format: 'wav',
            speed: 0.85
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer'
        });
        return Buffer.from(response.data);
    } catch (err) {
        console.error('[OpenAI TTS Error]:', err.response ? err.response.data : err.message);
        throw err;
    }
}

let cachedWelcomeAudio = null;
const cachedPersonalizedWelcomeAudio = new Map();
let cachedUnregisteredPhoneAudio = null;

async function getWelcomeAudio() {
    if (!cachedWelcomeAudio) {
        const welcomeText = "Namaskar! શ્રીમદ રાજચંદ્ર આત્મ તત્વ રિસર્ચ સેન્ટરમાં આપનું સ્વાગત છે. હું તમારી બુકિંગ માટે મદદ કરીશ. કૃપા કરીને આપનો નોંધાયેલ das ankno mobile number janavo.";
        console.log('[Welcome Cache] Generating welcome audio cache...');
        cachedWelcomeAudio = await generateOpenAITts(welcomeText);
    }
    return cachedWelcomeAudio;
}

async function getPersonalizedWelcomeAudio(sessionInfo) {
    const cacheKey = `${sessionInfo.name}|${sessionInfo.centre_name}`;
    if (!cachedPersonalizedWelcomeAudio.has(cacheKey)) {
        const welcomeText = `${sessionInfo.name}, Namaskar! ${sessionInfo.centre_name} તરફથી આપનું સ્વાગત છે. આપ ક્યારથી ક્યાં સુધી આવવા માંગો છો?`;
        console.log(`[Welcome Cache] Generating personalized welcome audio for ${sessionInfo.name}...`);
        cachedPersonalizedWelcomeAudio.set(cacheKey, await generateOpenAITts(welcomeText));
    }
    return cachedPersonalizedWelcomeAudio.get(cacheKey);
}

async function getUnregisteredPhoneAudio() {
    if (!cachedUnregisteredPhoneAudio) {
        const errorText = "માફ કરશો, આ ફોન નંબર આપણી સિસ્ટમમાં નોંધાયેલ નથી. કૃપા કરીને કેન્દ્ર સાથે સંપર્ક કરો.";
        console.log('[Welcome Cache] Generating unregistered-phone audio cache...');
        cachedUnregisteredPhoneAudio = await generateOpenAITts(errorText);
    }
    return cachedUnregisteredPhoneAudio;
}

function normalizeGujaratiDigits(text) {
    if (!text) return '';
    let normalized = text.toLowerCase();

    // Replace Gujarati and phonetic English word digits with English digit chars
    const map = {
        'શૂન્ય': '0', 'ઝીરો': '0',
        'એક': '1', 'વન': '1',
        'બે': '2', 'ટુ': '2', 'ટૂ': '2',
        'ત્રણ': '3', 'થ્રી': '3',
        'ચાર': '4', 'ફોર': '4',
        'પાંચ': '5', 'ફાઇવ': '5', 'ફાઈવ': '5',
        'છ': '6', 'સિક્સ': '6',
        'સાત': '7', 'સેવન': '7',
        'આઠ': '8', 'એટ': '8',
        'નવ': '9', 'નાઇન': '9', 'નાઈન': '9'
    };

    for (const [word, digit] of Object.entries(map)) {
        normalized = normalized.split(word).join(digit);
    }

    // Also replace native Gujarati digits (૦-૯)
    const nativeMap = {
        '૦': '0', '૧': '1', '૨': '2', '૩': '3', '૪': '4',
        '૫': '5', '૬': '6', '૭': '7', '૮': '8', '૯': '9'
    };
    for (const [char, digit] of Object.entries(nativeMap)) {
        normalized = normalized.split(char).join(digit);
    }

    // Devanagari words: Whisper auto-detects Gujarati audio as Devanagari
    // Longer variants must come first to avoid prefix-match corruption
    const devanagariMap = {
        'शून्य': '0', 'शुन्य': '0', 'ज़ीरो': '0', 'जीरो': '0',
        'एक': '1',
        'दो': '2', 'बे': '2',
        'त्रन्च': '3', 'तीन': '3', 'त्रण': '3',
        'चार': '4',
        'पाँच': '5', 'पांच': '5', 'पञ्च': '5',
        'छह': '6', 'छे': '6',
        'सात': '7',
        'आटू': '8', 'आठ': '8', 'आट': '8',
        'नौ': '9', 'नव': '9'
    };
    for (const [word, digit] of Object.entries(devanagariMap)) {
        normalized = normalized.split(word).join(digit);
    }

    // Native Devanagari digits (०-९)
    const devanagariDigits = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
    for (const [char, digit] of Object.entries(devanagariDigits)) {
        normalized = normalized.split(char).join(digit);
    }

    return normalized;
}

function extractPhoneNumber(text) {
    if (!text) return null;
    const normalized = normalizeGujaratiDigits(text);

    // 1. Look for a compact 10-digit block (e.g. "9883636830" typed or digit-string)
    const compactMatch = normalized.match(/(?:91)?([6-9]\d{9})(?!\d)/);
    if (compactMatch) return compactMatch[1];

    // 2. Look for 10 space-separated single digits (spoken digit-by-digit: "9 8 8 3...")
    const spacedMatch = normalized.match(/(?<![\d])(?:\d\s+){9}\d(?!\s*\d)/);
    if (spacedMatch) {
        const digits = spacedMatch[0].replace(/\D/g, '');
        if (digits.length === 10) return digits;
    }

    // 3. Fallback: strip everything, remove country code, take last 10
    //    Only accept if total digit count is 10–12 (prevents date/other number pollution)
    const allDigits = normalized.replace(/\D/g, '');
    if (allDigits.length >= 10 && allDigits.length <= 12) {
        const cleaned = allDigits.replace(/^91/, '').slice(-10);
        if (cleaned.length === 10) return cleaned;
    }

    return null;
}

function isFillerOrSilence(text) {
    if (!text) return true;
    const clean = text.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
    const fillers = ['okay', 'ok', 'so', 'yes', 'yeah', 'hallo', 'hello', 'હા', 'હાજી', 'ઓકે', 'સારું', 'só', 'right', 'correct', 'what', 'uh', 'um', 'ah', 'like', 'know'];
    return clean.length === 0 || fillers.includes(clean);
}

async function transcribeAudio(fileBuffer, mimetype = 'audio/webm', originalname = 'voice_booking.webm') {
    try {
        console.log(`[OpenAI STT] Transcribing user audio: ${originalname} (${mimetype})...`);
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: originalname,
            contentType: mimetype
        });
        formData.append('model', 'whisper-1');

        const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                ...formData.getHeaders()
            }
        });

        if (response.data && response.data.text) {
            const transcriptText = response.data.text.trim();
            console.log(`[OpenAI STT] Transcript: "${transcriptText}"`);
            return transcriptText;
        }
        return '';
    } catch (err) {
        console.error('[OpenAI STT Error]:', err.response ? err.response.data : err.message);
        return '';
    }
}

// Pre-cache welcome audio on server startup
getWelcomeAudio().catch(err => console.error('[Welcome Cache Error] Failed to pre-cache welcome audio:', err));

// ── GET VOICE WELCOME MESSAGE ───────────────────────────────────────────────
app.get('/api/voice-welcome', async (req, res) => {
    const sessionId = req.query.sessionId || `welcome_${Date.now()}`;
    console.log(`[Welcome] Starting welcome for session: ${sessionId}`);

    try {
        const suppliedPhone = req.query.phone_number || req.query.phone || req.query.mobile;
        let sessionInfo = verifiedSessions.get(sessionId);

        if (!sessionInfo && suppliedPhone) {
            const user = await lookupRegisteredUserByPhone(suppliedPhone);
            if (user) {
                cacheVerifiedSession(sessionId, user);
                sessionInfo = verifiedSessions.get(sessionId);
                console.log(`[Welcome] Phone verified from MySQL for session ${sessionId}: ${user.name}`);
            } else if (cleanPhoneNumber(suppliedPhone).length === 10) {
                console.log(`[Welcome] Supplied phone is not registered for session ${sessionId}.`);
                const errorAudio = await getUnregisteredPhoneAudio();
                res.set('Content-Type', 'audio/wav');
                res.set('X-End-Call', 'true');
                return res.send(errorAudio);
            }
        }

        // Return the correct welcome audio from cache immediately
        const audioBuffer = sessionInfo && sessionInfo.verified
            ? await getPersonalizedWelcomeAudio(sessionInfo)
            : await getWelcomeAudio();

        res.set('Content-Type', 'audio/wav');
        return res.send(audioBuffer);
    } catch (err) {
        console.error('[Welcome Error]:', err);
        return res.status(500).json({ error: 'Welcome pipeline failed', message: err.message });
    }
});

// Hardcoded mock database for development/testing
const mockUsers = {
    "9883636830": { name: "Mehul Pipalia", centre_name: "Kolkata Centre" },
    "8582950365": { name: "Urja Pipalia", centre_name: "Kolkata Centre" },
    "1234567890": { name: "Chetan Ganatra", centre_name: "Bangalore Centre" },
    "2468013579": { name: "Yashvi Hemani", centre_name: "Ahmedabad Centre" }
};


// ── VOICE BOOKING PROXY (OpenAI STT → n8n → OpenAI TTS) ─────────────────────
// ── VOICE BOOKING PROXY (Phone Verification in Server.js) ────────────────────
app.post('/api/voice-booking', upload.single('data'), async (req, res) => {
    const { sessionId } = req.query;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId query param is required' });
    }

    try {
        let fileBuffer;
        let isFromText = false;
        let textInput = null;
        let textHistoryHint = '';

        if (!req.file) {
            if (req.body && req.body.text) {
                console.log(`[Voice text fallback] Text input: "${req.body.text}"`);
                textInput = req.body.text;
                isFromText = true;
            } else {
                return res.status(400).json({ error: 'No audio file or text input received' });
            }
        } else {
            fileBuffer = req.file.buffer;
        }

        let isWav = isFromText;

        // Check if session is already verified
        const isAlreadyVerified = verifiedSessions.has(sessionId);

        let parsedDatesForUrl = null;
        if (isFromText) {
            const parsedDates = parseNaturalDateRange(textInput);
            if (parsedDates) {
                parsedDatesForUrl = parsedDates;
                textHistoryHint = `Guest: ${textInput}\nSystem date parser: start_date=${parsedDates.start}, end_date=${parsedDates.end}. The guest has provided the check-in and check-out dates. Do not ask for dates again; confirm these dates and continue to the next required booking field.\n`;
                // Use natural month-name format for TTS (still needed for voice playback continuity).
                const monthNamesForSpeech = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                const [sy, sm, sd] = parsedDates.start.split('-');
                const [ey, em, ed] = parsedDates.end.split('-');
                const startNatural = `${parseInt(sd)} ${monthNamesForSpeech[parseInt(sm) - 1]} ${sy}`;
                const endNatural = `${parseInt(ed)} ${monthNamesForSpeech[parseInt(em) - 1]} ${ey}`;
                textInput = `ચેક-ઇન ${startNatural} અને ચેક-આઉટ ${endNatural}.`;
                console.log(`[Voice text date parsed] ${parsedDates.start} to ${parsedDates.end} → TTS: "${textInput}"`);
            }
        }
        let phoneNum = null;

        if (!isAlreadyVerified && !parsedDatesForUrl) {
            // Get transcript/text to inspect for phone number
            let transcript = '';
            if (isFromText) {
                transcript = textInput;
            } else {
                transcript = await transcribeAudio(fileBuffer, req.file.mimetype, req.file.originalname);
            }

            // If empty/silent transcript or filler words, return 204 No Content
            if (!transcript || isFillerOrSilence(transcript)) {
                console.log(`[Silence/Filler] Silence or filler detected ("${transcript}") for session ${sessionId}. Returning 204.`);
                return res.status(204).end();
            }

            // Check if there is a 10-digit phone number in the transcript/text
            phoneNum = extractPhoneNumber(transcript);

            if (phoneNum) {
                console.log(`[Phone Recognized] Extracted phone number: ${phoneNum}`);
                const user = await lookupRegisteredUserByPhone(phoneNum);

                if (user) {
                    console.log(`[Phone Verified] Found registered user: ${user.name}`);
                    cacheVerifiedSession(sessionId, user);
                    const sessionInfo = verifiedSessions.get(sessionId);

                    // For both text and voice: return the personalized greeting immediately.
                    // Never send the phone audio to n8n — n8n re-transcribes it and the AI Agent
                    // often extracts the wrong digit count, causing verify_phone to fail.
                    const greetingAudio = await getPersonalizedWelcomeAudio(sessionInfo);
                    console.log(`[Phone Verified] Returning greeting for ${user.name}, session ${sessionId}`);
                    res.set('Content-Type', 'audio/wav');
                    return res.send(greetingAudio);
                } else {
                    console.log(`[Phone Unregistered] Phone ${phoneNum} is not registered.`);
                    const errorText = "માફ કરશો, આ ફોન નંબર આપણી સિસ્ટમમાં નોંધાયેલ નથી. કૃપા કરીને કેન્દ્ર સાથે સંપર્ક કરો.";
                    const errorAudio = await generateOpenAITts(errorText);
                    res.set('Content-Type', 'audio/wav');
                    res.set('X-End-Call', 'true');
                    return res.send(errorAudio);
                }
            } else {
                // If it is NOT a phone number and is not verified, but we already have text input,
                // we should convert it to audio buffer as in the original fallback behavior.
                if (isFromText) {
                    fileBuffer = await generateOpenAITts(textInput);
                    isWav = true;
                }
            }
        } else {
            if (isFromText) {
                // Text input: convert to audio for n8n
                fileBuffer = await generateOpenAITts(textInput);
                isWav = true;
            } else {
                // Voice input for verified session — transcribe on server to reliably extract dates
                const voiceTranscript = await transcribeAudio(fileBuffer, req.file.mimetype, req.file.originalname);
                if (voiceTranscript && !isFillerOrSilence(voiceTranscript)) {
                    console.log(`[Verified Voice] Transcript: "${voiceTranscript}"`);
                    const parsedDates = parseNaturalDateRange(voiceTranscript);
                    if (parsedDates) {
                        parsedDatesForUrl = parsedDates;
                        console.log(`[Verified Voice Date] ${parsedDates.start} → ${parsedDates.end}`);
                    }
                }
                // Original audio still sent to n8n; normalize node uses URL params if dates found
            }
        }

        const history = `${getTranscriptForSession(sessionId)}${textHistoryHint}`;

        const filename = isWav ? 'audio.wav' : 'audio.webm';
        const contentTypeHeader = isWav ? 'audio/wav' : 'audio/webm';

        const n8nForm = new FormData();
        n8nForm.append('data', fileBuffer, {
            filename: filename,
            contentType: contentTypeHeader
        });
        n8nForm.append('history', history || '');

        let n8nUrl = `${process.env.N8N_WEBHOOK_URL}?sessionId=${sessionId}`;
        const sessionInfo = verifiedSessions.get(sessionId);

        if (sessionInfo && sessionInfo.verified) {
            n8nUrl += `&verified=true&name=${encodeURIComponent(sessionInfo.name)}&centre_name=${encodeURIComponent(sessionInfo.centre_name)}`;
        }
        // Pass parsed dates as query params so the n8n Code node can read them via
        // $('Webhook').item.json.query (query params are accessible; form body fields are not).
        if (parsedDatesForUrl) {
            n8nUrl += `&start_date=${encodeURIComponent(parsedDatesForUrl.start)}&end_date=${encodeURIComponent(parsedDatesForUrl.end)}`;
        }
        console.log(`Forwarding audio to n8n: ${n8nUrl}`);

        let n8nRes;
        try {
            n8nRes = await axios.post(n8nUrl, n8nForm, {
                headers: { ...n8nForm.getHeaders() },
                responseType: 'arraybuffer',
                timeout: 60000
            });
        } catch (err) {
            const errString = err.response && err.response.data
                ? (Buffer.isBuffer(err.response.data)
                    ? err.response.data.toString()
                    : JSON.stringify(err.response.data))
                : '';

            const isWebhookNotRegistered = (err.response && err.response.status === 404) ||
                errString.includes('not registered') ||
                (err.message && err.message.includes('404'));

            if (isWebhookNotRegistered && n8nUrl.includes('/webhook/')) {
                const testUrl = n8nUrl.replace('/webhook/', '/webhook-test/');
                console.log(`Webhook not registered. Trying: ${testUrl}`);

                const retryForm = new FormData();
                retryForm.append('data', fileBuffer, { filename, contentType: contentTypeHeader });
                retryForm.append('history', history || '');

                n8nRes = await axios.post(testUrl, retryForm, {
                    headers: { ...retryForm.getHeaders() },
                    responseType: 'arraybuffer',
                    timeout: 60000
                });
            } else {
                // Timeout or other n8n error — return a graceful retry audio
                console.error('[n8n Timeout/Error]', err.code || err.message);
                const retryAudio = await generateOpenAITts('માફ કરશો, થોડી ટેકનિકલ સમસ્યા આવી. કૃપા કરીને ફરી એક વાર જવાબ આપો.');
                res.set('Content-Type', 'audio/wav');
                return res.send(retryAudio);
            }
        }

        const contentType = n8nRes.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
            const errBody = Buffer.from(n8nRes.data).toString();
            console.error('[n8n Error Response]', errBody);
            // Return graceful retry audio instead of crashing the frontend
            const retryAudio = await generateOpenAITts('માફ કરશો, ફરી એક વાર જવાબ આપો.');
            res.set('Content-Type', 'audio/wav');
            return res.send(retryAudio);
        }

        res.set('Content-Type', contentType || 'audio/wav');
        return res.send(Buffer.from(n8nRes.data));

    } catch (err) {
        console.error('[VOICE BOOKING ERROR]', err.message);
        try {
            const retryAudio = await generateOpenAITts('માફ કરશો, ફરી એક વાર જવાબ આપો.');
            res.set('Content-Type', 'audio/wav');
            return res.send(retryAudio);
        } catch (_) {
            return res.status(500).json({ error: 'Pipeline failed', message: err.message });
        }
    }
});
// ── STOP VOICE CALL & SAVE DRAFT BOOKING ──────────────────────────────────────
function deserializeN8nData(arr) {
    if (!Array.isArray(arr)) return arr;
    const cache = new Map();
    function resolve(val, visited = new Set()) {
        if (typeof val === 'string' && /^\d+$/.test(val)) {
            const idx = parseInt(val, 10);
            if (idx >= 0 && idx < arr.length) {
                return resolveValue(arr[idx], visited);
            }
        }
        return val;
    }
    function resolveValue(obj, visited = new Set()) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        if (cache.has(obj)) {
            return cache.get(obj);
        }
        if (visited.has(obj)) {
            return null;
        }
        visited.add(obj);
        let res;
        if (Array.isArray(obj)) {
            res = [];
            cache.set(obj, res);
            for (let i = 0; i < obj.length; i++) {
                res.push(resolve(obj[i], new Set(visited)));
            }
        } else {
            res = {};
            cache.set(obj, res);
            for (const [k, v] of Object.entries(obj)) {
                res[k] = resolve(v, new Set(visited));
            }
        }
        visited.delete(obj);
        return res;
    }
    return resolveValue(arr[0]);
}

function getTranscriptForSession(sessionId) {
    try {
        const { DatabaseSync } = require('node:sqlite');
        const path = require('path');
        const dbPath = path.join(process.env.HOME || '/Users/Urja', '.n8n', 'database.sqlite');
        const db = new DatabaseSync(dbPath);

        // Fetch recent executions to scan for the sessionId
        const query = db.prepare("SELECT executionId, data FROM execution_data ORDER BY executionId DESC LIMIT 200");
        const rows = query.all();

        const turns = [];

        for (const row of rows) {
            try {
                const rawArr = JSON.parse(row.data);
                const dataObj = deserializeN8nData(rawArr);

                if (dataObj && dataObj.resultData && dataObj.resultData.runData) {
                    const runData = dataObj.resultData.runData;
                    if (runData['Webhook']) {
                        const webhookItem = runData['Webhook'][0].data.main[0][0].json;
                        const sessId = webhookItem.query ? webhookItem.query.sessionId : null;

                        if (sessId === sessionId) {
                            let userSpoke = null;
                            let agentReplied = null;

                            // User speech
                            if (runData['Speech to text']) {
                                const stt = runData['Speech to text'][0].data.main[0][0].json;
                                userSpoke = stt.transcript || stt.text;
                                if (typeof userSpoke === 'object') {
                                    userSpoke = JSON.stringify(userSpoke);
                                }
                            }

                            // Agent reply
                            if (runData['AI Agent']) {
                                const agent = runData['AI Agent'][0].data.main[0][0].json;
                                agentReplied = agent.output;
                                if (typeof agentReplied === 'object') {
                                    agentReplied = JSON.stringify(agentReplied);
                                }
                            }

                            turns.push({
                                executionId: row.executionId,
                                user: userSpoke,
                                agent: agentReplied
                            });
                        }
                    }
                }
            } catch (e) {
                // Ignore parsing errors for single executions
            }
        }

        // Sort turns chronologically
        turns.sort((a, b) => a.executionId - b.executionId);

        // Build transcript string
        let transcript = "";
        for (const turn of turns) {
            const userText = (turn.user || "").trim();
            const agentText = (turn.agent || "").trim();
            if (userText || agentText) {
                transcript += `Guest: ${userText}\n`;
                if (agentText) {
                    transcript += `Booking Assistant: ${agentText}\n`;
                }
            }
        }
        return transcript;
    } catch (err) {
        console.error('Failed to get transcript from n8n DB:', err);
        return "";
    }
}

async function extractBookingDetailsFromTranscript(transcript) {
    const currentYear = new Date().getFullYear();
    const prompt = `Based on the conversation transcript between the Guest and the Booking Assistant, extract the guest's booking details.
Return ONLY a JSON object. Do not include markdown formatting or backticks around the JSON.
The JSON object must have the following fields:
- mumukshu_name (string or null)
- mumukshu_phone (string or null, clean 10-digit number)
- start_date (string or null, format YYYY-MM-DD. Assume the current year is ${currentYear} if no year is specified)
- end_date (string or null, format YYYY-MM-DD. Assume the current year is ${currentYear} if no year is specified)
- total_persons (integer or null)
- wants_room (boolean or null)
- floor_preference (string or null)
- has_breakfast (boolean or null)
- has_lunch (boolean or null)
- has_dinner (boolean or null)
- dietary_preference (string or null, e.g. "Regular" or "Non-spicy")

Transcript:
${transcript}`;

    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are an expert booking details extractor. You always output valid, clean JSON with the requested schema. No markdown formatting.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.0,
            response_format: { type: "json_object" }
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const content = response.data.choices[0].message.content;
        return JSON.parse(content);
    } catch (err) {
        console.error('OpenAI extraction failed:', err.response ? err.response.data : err.message);
        throw err;
    }
}

function getVerifiedUserFromSession(sessionId) {
    try {
        const { DatabaseSync } = require('node:sqlite');
        const path = require('path');
        const dbPath = path.join(process.env.HOME || '/Users/Urja', '.n8n', 'database.sqlite');
        const db = new DatabaseSync(dbPath);

        // Fetch recent executions to scan for the sessionId
        const query = db.prepare("SELECT executionId, data FROM execution_data ORDER BY executionId DESC LIMIT 100");
        const rows = query.all();

        for (const row of rows) {
            try {
                const rawArr = JSON.parse(row.data);
                const dataObj = deserializeN8nData(rawArr);

                if (dataObj && dataObj.resultData && dataObj.resultData.runData) {
                    const runData = dataObj.resultData.runData;
                    if (runData['Webhook']) {
                        const webhookItem = runData['Webhook'][0].data.main[0][0].json;
                        const sessId = webhookItem.query ? webhookItem.query.sessionId : null;

                        if (sessId === sessionId) {
                            if (runData['verify_phone']) {
                                const verifyData = runData['verify_phone'][0].data.ai_tool[0][0].json;
                                let targetObj = null;
                                if (verifyData) {
                                    if (Array.isArray(verifyData.response) && verifyData.response[0]) {
                                        targetObj = verifyData.response[0];
                                    } else if (verifyData.response) {
                                        targetObj = verifyData.response;
                                    } else {
                                        targetObj = verifyData;
                                    }
                                }
                                if (targetObj && (targetObj.found === 'true' || targetObj.found === true || targetObj.found === 1 || targetObj.name)) {
                                    return {
                                        verified: true,
                                        name: targetObj.name,
                                        phone: targetObj.phone || targetObj.phone_number,
                                        centre_name: targetObj.centre_name
                                    };
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }
    } catch (err) {
        console.error('Failed to get verified user from n8n DB:', err);
    }
    return null;
}

app.post('/api/stop-voice-call', async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    try {
        const transcript = getTranscriptForSession(sessionId);
        console.log(`[Stop Call] Transcript for ${sessionId}:\n`, transcript);

        if (!transcript.trim()) {
            return res.json({
                saved: false,
                incomplete: true,
                missing_fields: ['mumukshu_name', 'mumukshu_phone', 'start_date', 'end_date'],
                message: 'No conversation history found.'
            });
        }

        const b = await extractBookingDetailsFromTranscript(transcript);
        console.log(`[Stop Call] Extracted details:`, b);

        // Validate required fields
        const missing = [];
        if (!b.mumukshu_name) missing.push('mumukshu_name');
        if (!b.mumukshu_phone) missing.push('mumukshu_phone');
        if (!b.start_date) missing.push('start_date');
        if (!b.end_date) missing.push('end_date');

        if (missing.length > 0) {
            return res.json({
                saved: false,
                incomplete: true,
                missing_fields: missing
            });
        }

        // Save to DB
        const { getPool } = require('./lib/db');
        const [result] = await getPool().execute(
            `INSERT INTO bookings (
                mumukshu_name, mumukshu_phone, start_date, end_date, total_persons,
                wants_room, floor_preference, booked_shibir,
                has_breakfast, has_lunch, has_dinner, dietary_preference
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                b.mumukshu_name,
                b.mumukshu_phone,
                b.start_date,
                b.end_date,
                b.total_persons !== null && b.total_persons !== undefined ? parseInt(b.total_persons, 10) : 1,
                b.wants_room ? 1 : 0,
                b.floor_preference || null,
                null, // booked_shibir
                b.has_breakfast ? 1 : 0,
                b.has_lunch ? 1 : 0,
                b.has_dinner ? 1 : 0,
                b.dietary_preference || 'Regular'
            ]
        );

        return res.json({
            saved: true,
            booking_id: result.insertId
        });

    } catch (err) {
        console.error('[Stop Call Error]:', err);
        return res.status(500).json({ error: 'Failed to process stop action', message: err.message });
    }
});

app.listen(3000, () => console.log('🚀 Server running on port 3000'));
