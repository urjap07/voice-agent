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
async function generateSarvamTts(text, speaker = 'shubh') {
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

// ── GET VOICE WELCOME MESSAGE ───────────────────────────────────────────────
app.get('/api/voice-welcome', async (req, res) => {
    const sessionId = req.query.sessionId || `welcome_${Date.now()}`;
    console.log(`[Welcome] Starting dynamic welcome for session: ${sessionId}`);

    try {
        const silentWav = createSilentWav();
        const n8nForm = new FormData();
        n8nForm.append('data', silentWav, { filename: 'silent.wav', contentType: 'audio/wav' });

        const n8nUrl = `${process.env.N8N_WEBHOOK_URL}?sessionId=${sessionId}`;
        console.log(`[Welcome] Forwarding silent WAV to n8n to initialize session: ${n8nUrl}`);

        let n8nRes;
        let useDirectTts = false;

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
                                           (err.message && err.message.includes('404')) ||
                                           err.code === 'ECONNREFUSED';
            
            if (isWebhookNotRegistered) {
                if (n8nUrl.includes('/webhook/') && err.code !== 'ECONNREFUSED') {
                    const testUrl = n8nUrl.replace('/webhook/', '/webhook-test/');
                    console.log(`[Welcome] Webhook not registered. Trying test webhook URL: ${testUrl}`);
                    
                    try {
                        const n8nFormTest = new FormData();
                        n8nFormTest.append('data', silentWav, { filename: 'silent.wav', contentType: 'audio/wav' });

                        n8nRes = await axios.post(testUrl, n8nFormTest, {
                            headers: {
                                ...n8nFormTest.getHeaders()
                            },
                            responseType: 'arraybuffer'
                        });
                    } catch (testErr) {
                        console.log(`[Welcome] Test webhook failed. Falling back to direct Sarvam TTS.`);
                        useDirectTts = true;
                    }
                } else {
                    console.log(`[Welcome] Connection refused or error. Falling back to direct Sarvam TTS.`);
                    useDirectTts = true;
                }
            } else {
                throw err;
            }
        }

        if (useDirectTts) {
            const welcomeText = "નમસ્કાર! શ્રીમદ રાજચંદ્ર આત્મ તત્વ રિસર્ચ સેન્ટરમાં આપનું સ્વાગત છે. હું તમારી બુકિંગ માટે મદદ કરીશ. કૃપા કરીને આપનો નોંધાયેલ ૧૦-અંકનો મોબાઈલ નંબર જણાવો.";
            const audioBuffer = await generateSarvamTts(welcomeText, 'shubh');
            res.set('Content-Type', 'audio/wav');
            return res.send(audioBuffer);
        }

        res.set('Content-Type', n8nRes.headers['content-type'] || 'audio/wav');
        return res.send(Buffer.from(n8nRes.data));
    } catch (err) {
        if (err.response) {
            const errText = Buffer.isBuffer(err.response.data) ? err.response.data.toString() : JSON.stringify(err.response.data);
            console.error('[Welcome API Error]:', errText);
            return res.status(500).json({ error: 'n8n welcome pipeline failed', details: errText });
        } else {
            console.error('[Welcome General Error]:', err);
            return res.status(500).json({ error: 'Welcome pipeline failed', message: err.message, stack: err.stack });
        }
    }
});

// ── VOICE BOOKING PROXY (Sarvam → n8n → Sarvam) ──────────────────────────────
app.post('/api/voice-booking', upload.single('data'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio file received' });
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'sessionId query param is required' });

    try {
        const n8nForm = new FormData();
        n8nForm.append('data', req.file.buffer, { filename: 'audio.webm', contentType: 'audio/webm' });

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

        res.set('Content-Type', n8nRes.headers['content-type'] || 'audio/wav');
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

app.listen(3000, () => console.log('🚀 Server running on port 3000'));