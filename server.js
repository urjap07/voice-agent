require('dotenv').config();

const express = require('express');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const upload = multer();

// ── GLOBAL MIDDLEWARE ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// ── ROOT ROUTE (Serves front-end dashboard) ───────────────────────────────────
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
        const msg = err.code === 'ECONNREFUSED'
            ? 'MySQL is not running. Start MySQL in AMPPS or XAMPP.'
            : err.message;
        res.status(500).json({ ok: false, error: msg });
    }
});

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.get('/api/bookings', async (req, res) => {
    try {
        const { getPool } = require('./lib/db');
        const pool = getPool();
        const [rows] = await pool.query(
            'SELECT * FROM bookings ORDER BY booking_id DESC LIMIT 20'
        );
        res.json(rows);
    } catch (err) {
        console.error('List bookings error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/shibirs', async (req, res) => {
    try {
        const { getPool } = require('./lib/db');
        const pool = getPool();
        const [rows] = await pool.query(
            'SELECT shibir_id, shibir_name FROM shibirs ORDER BY shibir_id ASC'
        );
        res.json(rows);
    } catch (err) {
        console.error('List shibirs error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/bookings/manual', async (req, res) => {
    const booking = req.body;
    if (!booking.mumukshu_name || !booking.mumukshu_phone || !booking.start_date || !booking.end_date) {
        return res.status(400).json({ error: 'Name, Phone, Start Date, and End Date are required' });
    }

    const start = new Date(booking.start_date);
    const end = new Date(booking.end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid start or end date' });
    }
    if (end <= start) {
        return res.status(400).json({ error: 'Check-out date must be after check-in date' });
    }
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    if (diffDays > 9) {
        return res.status(400).json({ error: 'Stay duration cannot exceed 9 days' });
    }

    try {
        const { getPool } = require('./lib/db');
        const pool = getPool();

        const [result] = await pool.execute(
            `INSERT INTO bookings (
                mumukshu_name, mumukshu_phone, start_date, end_date,
                has_breakfast, has_lunch, has_dinner, dietary_preference
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                booking.mumukshu_name || null,
                booking.mumukshu_phone || null,
                booking.start_date || null,
                booking.end_date || null,
                booking.has_breakfast ? 1 : 0,
                booking.has_lunch ? 1 : 0,
                booking.has_dinner ? 1 : 0,
                booking.dietary_preference || 'Regular'
            ]
        );
        res.json({ saved: true, booking_id: result.insertId, row: booking });
    } catch (err) {
        console.error('Save manual booking error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── VERIFY REGISTERED PHONE NUMBER (From registered_users) ───────────────────
app.post('/verify-phone', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ found: false });

    const cleaned = phone.replace(/\D/g, '').replace(/^91/, '').slice(-10);

    try {
        const { getPool } = require('./lib/db');
        const pool = getPool();
        
        const [rows] = await pool.query(
            'SELECT name, centre_name FROM registered_users WHERE RIGHT(phone, 10) = ?',
            [cleaned]
        );

        if (!rows.length) {
            console.log(`[verify-phone] Not found in registered_users: ${cleaned}`);
            return res.json({ found: false });
        }

        console.log(`[verify-phone] Found user: ${rows[0].name} — ${rows[0].centre_name}`);
        return res.json({
            found: true,
            name: rows[0].name,
            centre_name: rows[0].centre_name,
        });
    } catch (err) {
        console.error('[verify-phone] DB error:', err.message);
        res.status(500).json({ found: false, error: err.message });
    }
});

// ── SARVAM AUDIO PASS-THROUGH PROXY (Prevents Browser CORS Blocks) ────────────
app.post('/api/voice-booking', upload.single('data'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file payload received.' });
        }

        // Pack the audio buffer back into a secure form submission payload
        const n8nForm = new FormData();
        n8nForm.append('data', req.file.buffer, {
            filename: 'voice_booking.webm',
            contentType: 'audio/webm'
        });

        console.log('[Backend Proxy] Forwarding audio file to n8n workflow pipeline...');
        
        // Post directly to n8n from the server-side architecture (No browser CORS rules apply here)
        const response = await axios.post('http://localhost:5678/webhook/sarvam-chat-loop', n8nForm, {
            headers: n8nForm.getHeaders()
        });

        // Send n8n processing response right back to the frontend client
        return res.json(response.data);

    } catch (err) {
        console.error('[Backend Error] Pass-through communications failed:', err.message);
        return res.status(500).json({ 
            error: 'Failed to process audio loop through n8n pipeline', 
            details: err.message 
        });
    }
});

// ── INITIALIZE SERVER ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening at http://localhost:${PORT}`);
    console.log(`Verify phone: POST /verify-phone`);
    console.log(`Sarvam Voice proxy pipeline destination: POST /api/voice-booking`);
});

module.exports = app;