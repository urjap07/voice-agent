const { getPool } = require('./db');
const { extractFromCall, isCompleteBooking } = require('./parseRetellBooking');

async function saveBookingFromCall(call) {
    const row = extractFromCall(call);

    if (!isCompleteBooking(row)) {
        return {
            saved: false,
            reason: 'Missing required fields (name, phone, start_date, end_date)',
            row,
        };
    }

    const pool = getPool();
    const [result] = await pool.execute(
        `INSERT INTO bookings (
            mumukshu_name, mumukshu_phone, start_date, end_date, total_persons,
            wants_room, floor_preference, booked_shibir,
            has_breakfast, has_lunch, has_dinner, dietary_preference
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            row.mumukshu_name,
            row.mumukshu_phone,
            row.start_date,
            row.end_date,
            row.total_persons,
            row.wants_room,
            row.floor_preference,
            row.booked_shibir,
            row.has_breakfast,
            row.has_lunch,
            row.has_dinner,
            row.dietary_preference,
        ]
    );

    return {
        saved: true,
        booking_id: result.insertId,
        row,
    };
}

module.exports = { saveBookingFromCall, extractFromCall, isCompleteBooking };
