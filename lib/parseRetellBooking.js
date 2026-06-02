const FIELD_ALIASES = {
    mumukshu_name: ['mumukshu_name', 'guest_name', 'name', 'customer_name'],
    mumukshu_phone: ['mumukshu_phone', 'phone', 'phone_number', 'mobile'],
    start_date: ['start_date', 'check_in_date', 'checkin_date', 'arrival_date'],
    end_date: ['end_date', 'check_out_date', 'checkout_date', 'departure_date'],
    total_persons: ['total_persons', 'number_of_guests', 'guests', 'persons'],
    wants_room: ['wants_room', 'room_required', 'needs_room'],
    floor_preference: ['floor_preference', 'floor', 'preferred_floor'],
    booked_shibir: ['booked_shibir', 'shibir', 'shibir_name', 'camp_name'],
    has_breakfast: ['has_breakfast', 'breakfast'],
    has_lunch: ['has_lunch', 'lunch'],
    has_dinner: ['has_dinner', 'dinner'],
    dietary_preference: ['dietary_preference', 'diet', 'food_preference'],
};

function pickValue(source, keys) {
    if (!source) return undefined;
    for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
            return source[key];
        }
    }
    return undefined;
}

function toBool(value) {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') return value ? 1 : 0;
    const s = String(value).toLowerCase().trim();
    return ['yes', 'true', '1', 'ha', 'હા', 'y'].includes(s) ? 1 : 0;
}

function toInt(value, fallback = 1) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toDateString(value) {
    if (!value) return null;
    const s = String(value).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
        const dd = dmy[1].padStart(2, '0');
        const mm = dmy[2].padStart(2, '0');
        return `${dmy[3]}-${mm}-${dd}`;
    }
    return null;
}

function extractFromCall(call) {
    const analysis = call?.call_analysis || {};
    const custom = analysis.custom_analysis_data || analysis;
    const dynamic = call?.retell_llm_dynamic_variables || {};
    const merged = { ...dynamic, ...custom, ...analysis };

    const row = {};
    for (const [column, aliases] of Object.entries(FIELD_ALIASES)) {
        row[column] = pickValue(merged, aliases);
    }

    return {
        mumukshu_name: row.mumukshu_name ? String(row.mumukshu_name).trim() : null,
        mumukshu_phone: row.mumukshu_phone ? String(row.mumukshu_phone).trim() : null,
        start_date: toDateString(row.start_date),
        end_date: toDateString(row.end_date),
        total_persons: toInt(row.total_persons, 1),
        wants_room: toBool(row.wants_room),
        floor_preference: row.floor_preference ? String(row.floor_preference).trim() : null,
        booked_shibir: row.booked_shibir ? String(row.booked_shibir).trim() : null,
        has_breakfast: toBool(row.has_breakfast),
        has_lunch: toBool(row.has_lunch),
        has_dinner: toBool(row.has_dinner),
        dietary_preference: row.dietary_preference
            ? String(row.dietary_preference).trim()
            : 'Regular',
        retell_call_id: call?.call_id || null,
    };
}

function isCompleteBooking(row) {
    return Boolean(
        row.mumukshu_name &&
        row.mumukshu_phone &&
        row.start_date &&
        row.end_date
    );
}

module.exports = { extractFromCall, isCompleteBooking };
