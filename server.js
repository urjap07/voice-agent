require('dotenv').config();

const express = require('express');
const path = require('path');
const { Retell } = require('retell-sdk');
const { saveBookingFromCall } = require('./lib/saveBooking');
const { finalizeBookingFromCallId } = require('./lib/finalizeBooking');

const app = express();

// ── GLOBAL MIDDLEWARE (Moved to top to prevent 404s) ──────────────────────────
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

        if (booking.booked_shibir && booking.booked_shibir.trim() !== '') {
            const shibirName = booking.booked_shibir.trim();
            const [shibirRows] = await pool.query(
                'SELECT * FROM shibirs WHERE shibir_name = ?',
                [shibirName]
            );
            if (shibirRows.length === 0) {
                const swadhyayKarta = booking.swadhyay_karta || 'Unknown';
                await pool.execute(
                    'INSERT INTO shibirs (shibir_name, swadhyay_karta) VALUES (?, ?)',
                    [shibirName, swadhyayKarta]
                );
                console.log(`Auto-added new shibir: ${shibirName}`);
            }
        }

        const [result] = await pool.execute(
            `INSERT INTO bookings (
                mumukshu_name, mumukshu_phone, start_date, end_date, total_persons,
                wants_room, floor_preference, booked_shibir,
                has_breakfast, has_lunch, has_dinner, dietary_preference
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                booking.mumukshu_name || null,
                booking.mumukshu_phone || null,
                booking.start_date || null,
                booking.end_date || null,
                parseInt(booking.total_persons, 10) || 1,
                booking.wants_room ? 1 : 0,
                booking.floor_preference || null,
                booking.booked_shibir || null,
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

app.post('/api/bookings/finalize', async (req, res) => {
    const callId = req.body?.call_id;
    if (!callId) {
        return res.status(400).json({ error: 'call_id is required' });
    }

    try {
        const result = await finalizeBookingFromCallId(callId);
        if (result.saved) {
            console.log(`Booking saved from call ${callId}: id=${result.booking_id}`);
        } else {
            console.warn(`Booking not saved for ${callId}:`, result.reason);
        }
        res.json(result);
    } catch (err) {
        console.error('Finalize booking error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── VERIFY REGISTERED PHONE NUMBER ────────────────────────────────────────────
app.post('/verify-phone', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ found: false });

    // Keeps last 10 digits and strips country code prefixes like 91
    const cleaned = phone.replace(/\D/g, '').replace(/^91/, '').slice(-10);

    try {
        const { getPool } = require('./lib/db');
        const pool = getPool();
        const [rows] = await pool.query(
            'SELECT name, centre_name FROM registered_users WHERE phone = ?',
            [cleaned]
        );

        if (!rows.length) {
            console.log(`[verify-phone] Not found: ${cleaned}`);
            return res.json({ found: false });
        }

        console.log(`[verify-phone] Found: ${rows[0].name} — ${rows[0].centre_name}`);
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

// ── RETELL AI WEBHOOK ─────────────────────────────────────────────────────────
app.post(
    '/webhook/retell',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const rawBody = req.body.toString('utf-8');
        const apiKey = process.env.RETELL_API_KEY;

        if (apiKey && process.env.SKIP_WEBHOOK_VERIFY !== 'true') {
            const signature = req.headers['x-retell-signature'];
            if (!Retell.verify(rawBody, apiKey, signature)) {
                console.error('Invalid Retell webhook signature');
                return res.status(401).send();
            }
        }

        let payload;
        try {
            payload = JSON.parse(rawBody);
        } catch {
            return res.status(400).send();
        }

        const { event, call } = payload;

        if (event === 'call_analyzed' && call?.call_id) {
            try {
                const result = await finalizeBookingFromCallId(call.call_id);
                if (result.saved) {
                    console.log(`Webhook booking saved: id=${result.booking_id}`);
                }
            } catch (err) {
                console.error('Webhook MySQL insert failed:', err);
                return res.status(500).send();
            }
        }

        res.status(204).send();
    }
);

// ── RETELL WEB CALL ORIGINATION ───────────────────────────────────────────────
async function createWebCall(req, res) {
    const apiKey = process.env.RETELL_API_KEY;
    const agentId = process.env.RETELL_AGENT_ID || req.body?.agent_id;

    if (!apiKey || !agentId) {
        return res.status(500).json({
            error: 'Missing RETELL_API_KEY or RETELL_AGENT_ID in .env',
        });
    }

    try {
        const response = await fetch('https://api.retellai.com/v2/create-web-call', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ agent_id: agentId }),
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        console.error('Retell create-web-call error:', err);
        res.status(500).json({ error: 'Failed to create web call' });
    }
}

app.post('/create-web-call', createWebCall);
app.post('/create_web_call', createWebCall);

// ── INITIALIZE SERVER (Local Fallback) ────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening at http://localhost:${PORT}`);
    console.log(`Verify phone: POST /verify-phone`);
    console.log(`Save booking after call: POST /api/bookings/finalize`);
    console.log(`Retell webhook (optional): http://localhost:${PORT}/webhook/retell`);
});

// ── EXPORT FOR VERCEL SERVERLESS RUNTIME ──────────────────────────────────────
module.exports = app;