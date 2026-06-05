require('dotenv').config();

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
app.post('/api/verify-phone', async (req, res) => {
    const phoneVal = req.body.phone_number || req.body.phone;
    if (!phoneVal) {
        return res.json({ found: false, error: 'Phone number is required' });
    }
    const cleaned = phoneVal.replace(/\D/g, '').replace(/^91/, '').slice(-10);
    try {
        const { getPool } = require('./lib/db');
        const [rows] = await getPool().query('SELECT name, centre_name FROM registered_users WHERE RIGHT(phone, 10) = ?', [cleaned]);
        if (!rows.length) return res.json({ found: false });
        res.json({ found: true, name: rows[0].name, centre_name: rows[0].centre_name });
    } catch (err) {
        res.status(500).json({ found: false, error: err.message });
    }
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
        const n8nForm = new FormData();
        n8nForm.append('data', silentWav, { filename: 'silent.wav', contentType: 'audio/wav' });

        const n8nUrl = `${process.env.N8N_WEBHOOK_URL}?sessionId=${sessionId}`;
        console.log(`[Welcome] Background initializing n8n session: ${n8nUrl}`);

        axios.post(n8nUrl, n8nForm, {
            headers: {
                ...n8nForm.getHeaders()
            },
            responseType: 'arraybuffer'
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

// ── VOICE BOOKING PROXY (Sarvam → n8n → Sarvam) ──────────────────────────────
app.post('/api/voice-booking', upload.single('data'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio file received' });
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'sessionId query param is required' });

    try {
        const history = getTranscriptForSession(sessionId);
        const n8nForm = new FormData();
        n8nForm.append('data', req.file.buffer, { filename: 'audio.webm', contentType: 'audio/webm' });
        n8nForm.append('history', history || '');

        const n8nUrl = `${process.env.N8N_WEBHOOK_URL}?sessionId=${sessionId}`;
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
                ? (Buffer.isBuffer(err.response.data) ? err.response.data.toString() : JSON.stringify(err.response.data))
                : '';
            const isWebhookNotRegistered = (err.response && err.response.status === 404) ||
                errString.includes('not registered') ||
                (err.message && err.message.includes('404'));

            if (isWebhookNotRegistered && n8nUrl.includes('/webhook/')) {
                const testUrl = n8nUrl.replace('/webhook/', '/webhook-test/');
                console.log(`Webhook not registered. Trying test webhook URL: ${testUrl}`);

                const n8nFormTest = new FormData();
                n8nFormTest.append('data', req.file.buffer, { filename: 'audio.webm', contentType: 'audio/webm' });
                n8nFormTest.append('history', history || '');

                n8nRes = await axios.post(testUrl, n8nFormTest, {
                    headers: {
                        ...n8nFormTest.getHeaders()
                    },
                    responseType: 'arraybuffer'
                });
            } else {
                throw err;
            }
        }

        const contentType = n8nRes.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
            console.error('[n8n Response Error]: Received JSON instead of audio:', n8nRes.data.toString());
            res.set('Content-Type', 'application/json');
            return res.status(500).send(n8nRes.data);
        }
        res.set('Content-Type', contentType || 'audio/wav');
        return res.send(Buffer.from(n8nRes.data));

    } catch (err) {
        if (err.response) {
            const errText = Buffer.isBuffer(err.response.data) ? err.response.data.toString() : JSON.stringify(err.response.data);
            console.error('[n8n API Error]:', errText);
            return res.status(500).json({ error: 'n8n pipeline failed', details: errText });
        } else {
            console.error('[General Error]:', err);
            return res.status(500).json({ error: 'Pipeline failed', message: err.message, stack: err.stack });
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
    const prompt = `Based on the conversation transcript between the Guest and the Booking Assistant, extract the guest's booking details.
Return ONLY a JSON object. Do not include markdown formatting or backticks around the JSON.
The JSON object must have the following fields:
- mumukshu_name (string or null)
- mumukshu_phone (string or null, clean 10-digit number)
- start_date (string or null, format YYYY-MM-DD)
- end_date (string or null, format YYYY-MM-DD)
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