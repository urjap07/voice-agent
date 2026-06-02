/**
 * Optimize for slow-spoken Gujarati answers (listen longer, better STT).
 * Run: npm run fix:slow-speech
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const agentId = process.env.RETELL_AGENT_ID;
const apiKey = process.env.RETELL_API_KEY;
const llmId = 'llm_d6d9dfa0e58fcd23a0565f5b4e2b';

const SLOW_SPEECH_RULES = `મુમુક્ષુ ધીમેથી બોલે ત્યારે:
- વચ્ચેની ટૂંકી શાંતિને જવાબ પૂરો થયો નહીં સમજો; સંપૂર્ણ જવાબ સાંભળ્યા પછી જ બોલો.
- જવાબ પછી પુષ્ટિ કરો: "બરાબર, તમે કહ્યું [જવાબ]..." પછી આગળનો સવાલ.
- ફોન નંબર અને તારીખ ધીમેથી આપે તો અંક-અંક પુષ્ટિ કરો.
- સ્પષ્ટ ન સાંભળાય તો "કૃપા કરીને ધીરેથી ફરીથી કહો" — અટાવો નહીં.

`;

const BOOSTED_KEYWORDS = [
    'નમસ્કાર', 'નામ', 'ફોન', 'મોબાઇલ', 'તારીખ', 'બુકિંગ', 'રૂમ', 'શિબિર',
    'ground floor', 'જૈન', 'સ્વામિનારાયણ', 'Regular', 'breakfast', 'lunch', 'dinner',
    'આજે', 'કાલે', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટેમ્બર',
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
        responsiveness: 0.1,
        interruption_sensitivity: 0.8,
        stt_mode: 'accurate',
        normalize_for_speech: true,
        enable_backchannel: true,
        denoising_mode: 'no-denoise',
        boosted_keywords: BOOSTED_KEYWORDS,
        end_call_after_silence_ms: 180000,
        reminder_trigger_ms: 45000,
        reminder_max_count: 2,
        voice_speed: 0.95,
    });

    const llm = await api('GET', `/get-retell-llm/${llmId}`, null, '?version=1');
    let general_prompt = llm.general_prompt || '';

    general_prompt = general_prompt.replace(
        /અભિવાદન પછી તરત જ આગળ વધો — 2 સેકંડથી વધુ શાંતિ ન રાખો\.\n/g,
        ''
    );

    if (!general_prompt.includes('વચ્ચેની ટૂંકી શાંતિ')) {
        general_prompt = SLOW_SPEECH_RULES + general_prompt;
    }

    await api('PATCH', `/update-retell-llm/${llmId}`, { general_prompt }, '?version=1');

    console.log('Agent updated for slow speech:');
    console.log('  responsiveness: 0.1 (waits ~longest before replying)');
    console.log('  interruption_sensitivity: 0.8');
    console.log('  denoising: noise-cancellation only (keeps quiet slow voice)');
    console.log('  stt_mode: accurate');
    console.log('  boosted_keywords: Gujarati booking terms');
    console.log('\nStart a NEW call. Speak slowly; pause 1-2 sec between words is OK.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
