require('dotenv').config();

const express = require('express');
const path    = require('path');
const axios   = require('axios');
const multer  = require('multer');
const FormData = require('form-data');

const app    = express();
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

// ── VOICE BOOKING PROXY (Sarvam → n8n → Sarvam) ──────────────────────────────
app.post('/api/voice-booking', upload.single('data'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio file received' });

    try {
        // STEP 1: Sarvam STT
        const sttForm = new FormData();
        sttForm.append('file', req.file.buffer, { filename: 'audio.webm', contentType: 'audio/webm' });
        sttForm.append('model', 'saarika:v2');
        sttForm.append('language_code', 'gu-IN');

        const sttRes = await axios.post('https://api.sarvam.ai/speech-to-text', sttForm, {
            headers: { ...sttForm.getHeaders(), 'api-subscription-key': process.env.SARVAM_API_KEY }
        });

        const transcript = sttRes.data?.transcript || '';
        
        // STEP 2: Send to n8n
        const n8nRes = await axios.post(process.env.N8N_WEBHOOK_URL, { transcript });
        const bookingId = n8nRes.data?.booking_id || 'unknown';

        // STEP 3: Sarvam TTS
        const ttsRes = await axios.post('https://api.sarvam.ai/text-to-speech', {
            inputs: [`આપની બુકિંગ કન્ફર્મ થઈ ગઈ છે! બુકિંગ આઈડી ${bookingId} છે. ધન્યવાદ!`],
            target_language_code: 'gu-IN',
            speaker: 'anushka',
            model: 'bulbul:v2'
        }, {
            headers: { 'api-subscription-key': process.env.SARVAM_API_KEY, 'Content-Type': 'application/json' },
            responseType: 'arraybuffer'
        });

        res.set('Content-Type', 'audio/wav');
        return res.send(Buffer.from(ttsRes.data));

    } catch (err) {
        if (err.response) {
            console.error('[Sarvam API Error]:', JSON.stringify(err.response.data, null, 2));
        } else {
            console.error('[General Error]:', err.message);
        }
        return res.status(500).json({ error: 'Pipeline failed' });
    }
});

app.listen(3000, () => console.log('🚀 Server running on port 3000'));