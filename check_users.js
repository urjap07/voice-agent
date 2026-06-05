require('dotenv').config();
const { getPool } = require('./lib/db');

async function check() {
    try {
        const pool = getPool();
        const [rows] = await pool.query('DESCRIBE bookings');
        console.log('Bookings Columns:', rows);
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}
check();
