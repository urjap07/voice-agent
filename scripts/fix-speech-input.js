/**
 * Hear slow, quiet, and loud speech reliably (STT + turn-taking).
 * Run: npm run fix:speech-input
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const agentId = process.env.RETELL_AGENT_ID;
const apiKey = process.env.RETELL_API_KEY;
const llmId = 'llm_d6d9dfa0e58fcd23a0565f5b4e2b';

const SPEECH_INPUT_RULES = `અવાજની ગતિ અને માત્રા (ખૂબ મહત્વપૂર્ણ):
- મુમુક્ષુ ધીમેથી બોલે તો વચ્ચેની ટૂંકી શાંતિને જવાબ પૂરો નહીં સમજો; સંપૂર્ણ જવાબ સાંભળ્યા પછી જ બોલો.
- મુમુક્ષુ નીચા અવાજે બોલે તો પણ ધ્યાનથી સાંભળો; સ્પષ્ટ ન લાગે તો "કૃપા કરીને થોડું મોટેથી અને ધીરેથી ફરી કહો" પૂછો — અટાવો નહીં.
- મુમુક્ષુ મોટા અવાજે બોલે તો પણ સંપૂર્ણ સાંભળો; અવાજ મોટો હોવાથી જવાબ અધવચ્ચે ન અટકાવો.
- ફોન નંબર અને તારીખ ધીમેથી આપે તો અંક-અંક પુષ્ટિ કરો.

`;

const BOOSTED_KEYWORDS = [
    'નમસ્કાર', 'નામ', 'ફોન', 'મોબાઇલ', 'તારીખ', 'બુકિંગ', 'રૂમ', 'શિબિર',
    'ground floor', 'જૈન', 'સ્વામિનારાયણ', 'Regular', 'breakfast', 'lunch', 'dinner',
    'આજે', 'કાલે', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટેમ્બર',
    'હા', 'ના', 'બરાબર', 'ઠીક', 'ધીરે', 'ફરી',
];

async function api(method, path, body, query = '') {
    const res = await fetch(`https://api.retellai.com${path}${query}`, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
    return data;
}

async function main() {
    if (!apiKey || !agentId) {
        console.error('Set RETELL_API_KEY and RETELL_AGENT_ID in .env');
        process.exit(1);
    }

    await api('PATCH', `/update-agent/${agentId}`, {
        language: 'multi',
        responsiveness: 0.45,
        interruption_sensitivity: 0.88,
        stt_mode: 'accurate',
        normalize_for_speech: true,
        denoising_mode: 'noise-cancellation',
        enable_backchannel: true,
        boosted_keywords: BOOSTED_KEYWORDS,
        end_call_after_silence_ms: 180000,
        reminder_trigger_ms: 35000,
        reminder_max_count: 2,
        voice_speed: 0.95,
    });

    const llm = await api('GET', `/get-retell-llm/${llmId}`, null, '?version=1');
    let general_prompt = llm.general_prompt || '';

    if (!general_prompt.includes('નીચા અવાજે બોલે')) {
        general_prompt = SPEECH_INPUT_RULES + general_prompt;
    }

    await api('PATCH', `/update-retell-llm/${llmId}`, { general_prompt }, '?version=1');

    console.log('Speech input settings applied:');
    console.log('  responsiveness: 0.45 (patient but still reacts to your speech)');
    console.log('  interruption_sensitivity: 0.88 (picks up your voice reliably)');
    console.log('  denoising_mode: noise-cancellation');
    console.log('  normalize_for_speech: true');
    console.log('  stt_mode: accurate');
    console.log('\nStart a NEW call after hard-refreshing the page.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
