/**
 * Original booking flow: one question at a time; never advance without a clear answer.
 * Removes "skip unanswered" testing rules if present.
 * Run: npm run fix:require-answer
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const apiKey = process.env.RETELL_API_KEY;
const agentId = process.env.RETELL_AGENT_ID;
const llmId = 'llm_d6d9dfa0e58fcd23a0565f5b4e2b';

const SKIP_MARKER = 'સવાલ જવાબ વગર આગળ વધો (ટેસ્ટિંગ):';
const REQUIRE_MARKER = 'જવાબ વગર આગળ ન વધો:';

const REQUIRE_RULES = `જવાબ વગર આગળ ન વધો:
- એક સમયે માત્ર એક જ સવાલ પૂછો.
- મુમુક્ષુનો સંપૂર્ણ અને સ્પષ્ટ જવાબ લો; અસ્પષ્ટ હોય તો ફરી પૂછો — બીજો સવાલ ન પૂછો.
- જવાબ મળ્યા વિના "આગળ વધીએ", "ઠીક છે, આગળ" કહીને ક્રમ છોડો નહીં.
- ધીમી બોલી અથવા ટૂંકી શાંતિ માટે રાહ જુઓ; વચ્ચે અટકાવી આગલો સવાલ ન પૂછો.
- દરેક જવાબ પછી ટૂંકી પુષ્ટિ કરો ("બરાબર, તમે કહ્યું...") પછી જ આગલો સવાલ.

સવાલોનો ક્રમ (આ ક્રમમાં જ, પૂર્ણ જવાબ પછી જ આગળ):
1) નામ  2) ફોન નંબર  3) આગમન તારીખ  4) જવાની તારીખ  5) કુલ વ્યક્તિઓ
6) રૂમ જોઈએ કે નહીં (હા/ના)  7) ફ્લોર પસંદગી  8) શિબિર  9) બ્રેકફાસ્ટ  10) લંચ  11) ડિનર  12) આહાર પસંદગી

`;

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

function removeBlock(prompt, marker) {
    if (!prompt.includes(marker)) return prompt;
    const start = prompt.indexOf(marker);
    const listEnd = prompt.indexOf('12) આહાર', start);
    if (listEnd === -1) return prompt.slice(0, start) + prompt.slice(start + marker.length);
    const after = prompt.indexOf('\n\n', listEnd);
    if (after === -1) return prompt.slice(0, start).trim();
    return (prompt.slice(0, start) + prompt.slice(after + 2)).trim();
}

function applyRequireRules(general_prompt) {
    let prompt = removeBlock(general_prompt || '', SKIP_MARKER);
    prompt = removeBlock(prompt, REQUIRE_MARKER);
    return REQUIRE_RULES + prompt;
}

async function main() {
    if (!apiKey || !agentId) {
        console.error('Set RETELL_API_KEY and RETELL_AGENT_ID in .env');
        process.exit(1);
    }

    await api('PATCH', `/update-agent/${agentId}`, {
        responsiveness: 0.35,
        interruption_sensitivity: 0.8,
        stt_mode: 'accurate',
        reminder_trigger_ms: 45000,
        reminder_max_count: 2,
        enable_backchannel: true,
    });

    const llm = await api('GET', `/get-retell-llm/${llmId}`, null, '?version=1');
    const hadSkip = (llm.general_prompt || '').includes(SKIP_MARKER);

    await api(
        'PATCH',
        `/update-retell-llm/${llmId}`,
        { general_prompt: applyRequireRules(llm.general_prompt) },
        '?version=1'
    );

    console.log('Agent: wait for full answer before next question (patient STT settings).');
    if (hadSkip) console.log('Removed previous "skip unanswered" testing rules from LLM prompt.');
    console.log('Start a NEW call to test. Frontend stays original (no MySQL save on page).');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
