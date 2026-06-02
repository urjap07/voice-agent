const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchRetellCall(callId, apiKey) {
    const res = await fetch(`https://api.retellai.com/v2/get-call/${callId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.message || data.error || `Retell get-call failed (${res.status})`);
    }
    return data;
}

const { isCompleteBooking, extractFromCall } = require('./parseRetellBooking');

function hasCompleteAnalysis(call) {
    if (!call?.call_analysis) return false;
    return isCompleteBooking(extractFromCall(call));
}

const DEFAULT_ANALYSIS_MAX_MS = Number(process.env.RETELL_ANALYSIS_MAX_MS) || 3000;
const ANALYSIS_POLL_MS = Number(process.env.RETELL_ANALYSIS_POLL_MS) || 400;

async function fetchRetellCallWithAnalysis(
    callId,
    apiKey,
    maxWaitMs = DEFAULT_ANALYSIS_MAX_MS
) {
    const deadline = Date.now() + maxWaitMs;
    let lastCall = null;

    while (true) {
        lastCall = await fetchRetellCall(callId, apiKey);
        if (hasCompleteAnalysis(lastCall)) {
            return lastCall;
        }
        if (Date.now() >= deadline) {
            break;
        }
        await sleep(Math.min(ANALYSIS_POLL_MS, deadline - Date.now()));
    }

    return lastCall;
}

module.exports = { fetchRetellCall, fetchRetellCallWithAnalysis };
