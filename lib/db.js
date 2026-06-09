const mysql = require('mysql2/promise');

let pool;

function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.DB_HOST || '127.0.0.1',
            user: process.env.DB_USER || '',
            password: process.env.DB_PASSWORD || 'mysql',
            database: process.env.DB_NAME || 'booking_system',
            waitForConnections: true,
            connectionLimit: 10,
        });
    }
    return pool;
}

module.exports = { getPool };
