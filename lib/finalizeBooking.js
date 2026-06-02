const { fetchRetellCallWithAnalysis } = require('./fetchRetellCall');
const { saveBookingFromCall } = require('./saveBooking');

const savedCallIds = new Set();

async function finalizeBookingFromCallId(callId) {
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
        throw new Error('Missing RETELL_API_KEY in .env');
    }
    if (!callId) {
        throw new Error('call_id is required');
    }

    if (savedCallIds.has(callId)) {
        return { saved: false, reason: 'Booking already saved for this call', call_id: callId };
    }

    const call = await fetchRetellCallWithAnalysis(callId, apiKey);
    const result = await saveBookingFromCall(call);

    if (result.saved) {
        savedCallIds.add(callId);
    }

    return { ...result, call_id: callId };
}

module.exports = { finalizeBookingFromCallId };
