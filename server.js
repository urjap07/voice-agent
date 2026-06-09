require('dotenv').config();

const verifiedSessions = new Map();
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
    const cleaned = phone.replace(/\D/g, '').replace(/^91/, '').slice(-10);
    try {
        const { getPool } = require('./lib/db');
        const [rows] = await getPool().query('SELECT name, centre_name FROM registered_users WHERE RIGHT(phone, 10) = ?', [cleaned]);
        if (!rows.length) return res.json({ found: false });
        res.json({ found: true, name: rows[0].name, centre_name: rows[0].centre_name });
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

        const cleaned = String(phoneVal).replace(/\D/g, '').slice(-10);
        const { getPool } = require('./lib/db');

        const [rows] = await getPool().query(
            `SELECT user_id, phone, name, centre_name 
             FROM registered_users 
             WHERE RIGHT(phone, 10) = ? LIMIT 1`,
            [cleaned]
        );

        if (!rows.length) {
            return res.json({ found: false });
        }

        const user = rows[0];

        // Cache for the UI Live Preview
        if (req.body.sessionId) {
            verifiedSessions.set(req.body.sessionId, {
                verified: true,
                name: user.name,
                centre_name: user.centre_name,
                phone: user.phone
            });
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
    try {
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

// ── HELPER: DIRECT SARVAM TTS ────────────────────────────────────────────────
async function generateSarvamTts(text, speaker = 'shruti') {
    try {
        console.log(`[Sarvam TTS] Generating TTS for text: "${text}" with speaker: ${speaker}`);
        const response = await axios.post('https://api.sarvam.ai/text-to-speech', {
            inputs: [text],
            target_language_code: 'gu-IN',
            speaker: speaker,
            model: 'bulbul:v3'
        }, {
            headers: {
                'api-subscription-key': process.env.SARVAM_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.audios && response.data.audios[0]) {
            return Buffer.from(response.data.audios[0], 'base64');
        }
        throw new Error('No audio returned from Sarvam TTS API');
    } catch (err) {
        console.error('[Sarvam TTS Error]:', err.response ? err.response.data : err.message);
        throw err;
    }
}

let cachedWelcomeAudio = null;

async function getWelcomeAudio() {
    if (!cachedWelcomeAudio) {
        const welcomeText = "નમસ્કાર! શ્રીમદ રાજચંદ્ર આત્મ તત્વ રિસર્ચ સેન્ટરમાં આપનું સ્વાગત છે. હું તમારી બુકિંગ માટે મદદ કરીશ. કૃપા કરીને આપનો નોંધાયેલ ૧૦-અંકનો મોબાઈલ નંબર જણાવો.";
        console.log('[Welcome Cache] Generating welcome audio cache...');
        cachedWelcomeAudio = await generateSarvamTts(welcomeText, 'shruti');
    }
    return cachedWelcomeAudio;
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

    return normalized;
}

function extractPhoneNumber(text) {
    if (!text) return null;
    const normalized = normalizeGujaratiDigits(text);
    const digits = normalized.replace(/\D/g, '');
    const cleaned = digits.replace(/^91/, '').slice(-10);
    if (cleaned.length === 10) {
        return cleaned;
    }
    return null;
}

function isFillerOrSilence(text) {
    if (!text) return true;
    const clean = text.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
    const fillers = ['okay', 'ok', 'so', 'yes', 'yeah', 'hallo', 'hello', 'હા', 'હાજી', 'ઓકે', 'સારું', 'só', 'right', 'correct', 'what', 'uh', 'um', 'ah', 'like', 'know'];
    return clean.length === 0 || fillers.includes(clean);
}

async function transcribeAudio(fileBuffer) {
    try {
        console.log('[Sarvam STT] Transcribing user audio on server...');
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: 'voice_booking.webm',
            contentType: 'audio/webm'
        });
        formData.append('model', 'saaras:v3');
        formData.append('language_code', 'gu-IN');

        const response = await axios.post('https://api.sarvam.ai/speech-to-text', formData, {
            headers: {
                'api-subscription-key': process.env.SARVAM_API_KEY,
                ...formData.getHeaders()
            }
        });

        if (response.data && response.data.transcript) {
            const transcriptText = response.data.transcript.trim();
            console.log(`[Sarvam STT] Transcript: "${transcriptText}"`);
            return transcriptText;
        }
        return '';
    } catch (err) {
        console.error('[Sarvam STT Error]:', err.response ? err.response.data : err.message);
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
        // 1. Get welcome audio instantly from cache
        const audioBuffer = await getWelcomeAudio();

        // 2. Asynchronously initialize n8n in the background
        const silentWav = createSilentWav();
        // ... inside app.get('/api/voice-welcome') ...
        const n8nForm = new FormData();
        n8nForm.append('data', silentWav, { filename: 'silent.wav', contentType: 'audio/wav' });

        // ADD THIS: Inject verified status into the init call
        // Ensure this is inside your app.get('/api/voice-welcome')
        const sessionInfo = verifiedSessions.get(sessionId);
        if (sessionInfo && sessionInfo.verified) {
            n8nForm.append('user_context', JSON.stringify({
                is_verified: true,
                name: sessionInfo.name,
                centre_name: sessionInfo.centre_name
            }));
        }

        const n8nUrl = `${process.env.N8N_WEBHOOK_URL}?sessionId=${sessionId}`;
        console.log(`[Welcome] Background initializing n8n session: ${n8nUrl}`);

        axios.post(n8nUrl, n8nForm, {
            headers: {
                ...n8nForm.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: 60000,           // Add this
            maxContentLength: Infinity, // Add this
            maxBodyLength: Infinity     // Add this
        }).then(() => {
            console.log(`[Welcome] Background n8n initialization complete for session: ${sessionId}`);
        }).catch(err => {
            console.warn(`[Welcome Warning] Background n8n initialization failed: ${err.message}`);
        });

        // 3. Immediately return the welcome audio to the client
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

// ── VOICE BOOKING PROXY (Sarvam → n8n → Sarvam) ──────────────────────────────
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
        let phoneNum = null;

        if (!isAlreadyVerified) {
            // Get transcript/text to inspect for phone number
            let transcript = '';
            if (isFromText) {
                transcript = textInput;
            } else {
                transcript = await transcribeAudio(fileBuffer);
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
                const { getPool } = require('./lib/db');
                const [rows] = await getPool().query(
                    'SELECT user_id, phone, name, centre_name FROM registered_users WHERE RIGHT(phone, 10) = ? LIMIT 1',
                    [phoneNum]
                );

                if (rows.length > 0) {
                    const user = rows[0];
                    console.log(`[Phone Verified] Found registered user: ${user.name}`);
                    verifiedSessions.set(sessionId, {
                        verified: true,
                        user_id: user.user_id,
                        phone: user.phone,
                        name: user.name,
                        centre_name: user.centre_name
                    });

                    // Generate a clean audio representation of the digits to feed into n8n
                    // so n8n updates its internal state correctly and returns the personalized welcome greeting.
                    console.log(`[Phone Verified] Generating clean digits audio for n8n...`);
                    fileBuffer = await generateSarvamTts(phoneNum, 'shruti');
                    isWav = true; // We now have clean WAV audio
                } else {
                    console.log(`[Phone Unregistered] Phone ${phoneNum} is not registered.`);
                    const errorText = "માફ કરશો, આ ફોન નંબર આપણી સિસ્ટમમાં નોંધાયેલ નથી. કૃપા કરીને કેન્દ્ર સાથે સંપર્ક કરો.";
                    const errorAudio = await generateSarvamTts(errorText, 'shruti');
                    res.set('Content-Type', 'audio/wav');
                    res.set('X-End-Call', 'true');
                    return res.send(errorAudio);
                }
            } else {
                // If it is NOT a phone number and is not verified, but we already have text input,
                // we should convert it to audio buffer as in the original fallback behavior.
                if (isFromText) {
                    fileBuffer = await generateSarvamTts(textInput, 'shruti');
                    isWav = true;
                }
            }
        } else {
            // If already verified, and we have text input, we need to convert it to audio buffer
            if (isFromText) {
                fileBuffer = await generateSarvamTts(textInput, 'shruti');
                isWav = true;
            }
        }

        const history = getTranscriptForSession(sessionId);

        const filename = isWav ? 'audio.wav' : 'audio.webm';
        const contentTypeHeader = isWav ? 'audio/wav' : 'audio/webm';

        const n8nForm = new FormData();
        n8nForm.append('data', fileBuffer, {
            filename: filename,
            contentType: contentTypeHeader
        });
        n8nForm.append('history', history || '');

        // Ensure this part is correctly populating the URL
        let n8nUrl = `${process.env.N8N_WEBHOOK_URL}?sessionId=${sessionId}`;
        const sessionInfo = verifiedSessions.get(sessionId);

        if (sessionInfo && sessionInfo.verified) {
            // Add verified info as query params that the AI Agent can easily read
            n8nUrl += `&verified=true&name=${encodeURIComponent(sessionInfo.name)}&centre_name=${encodeURIComponent(sessionInfo.centre_name)}`;
        }
        console.log(`Forwarding audio to n8n: ${n8nUrl}`);

        let n8nRes;
        try {
            n8nRes = await axios.post(n8nUrl, n8nForm, {
                headers: {
                    ...n8nForm.getHeaders()
                },
                responseType: 'arraybuffer'
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
                retryForm.append('data', fileBuffer, {
                    filename: filename,
                    contentType: contentTypeHeader
                });
                retryForm.append('history', history || '');

                n8nRes = await axios.post(testUrl, retryForm, {
                    headers: {
                        ...retryForm.getHeaders()
                    },
                    responseType: 'arraybuffer'
                });
            } else {
                throw err;
            }
        }

        const contentType = n8nRes.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
            console.error('[n8n Error]', Buffer.from(n8nRes.data).toString());
            res.set('Content-Type', 'application/json');
            return res.status(500).send(n8nRes.data);
        }

        res.set('Content-Type', contentType || 'audio/wav');
        return res.send(Buffer.from(n8nRes.data));

    } catch (err) {
        console.error('[VOICE BOOKING ERROR]', err);
        return res.status(500).json({
            error: 'Pipeline failed',
            message: err.message
        });
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