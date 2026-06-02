/**
 * Fix call opening greeting: use "નમસ્કાર" only (not "જય સ્વામિનારાયણ").
 * Run: node scripts/fix-greeting.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const apiKey = process.env.RETELL_API_KEY;
const agentId = process.env.RETELL_AGENT_ID;
const llmId = 'llm_d6d9dfa0e58fcd23a0565f5b4e2b';

const BEGIN_MESSAGE =
    'નમસ્કાર! શ્રીમદ રાજચંદ્ર આત્મ તત્વ રિસર્ચ સેન્ટરમાં આપનું સ્વાગત છે. હું તમારી બુકિંગ માટે મદદ કરીશ. કૃપા કરીને તમારું નામ કહો.';

const GREETING_RULE =
    'કૉલની શરૂઆતમાં હંમેશા માત્ર "નમસ્કાર" કહીને અભિવાદન કરો. "જય સ્વામિનારાયણ" અથવા અન્ય ધાર્મિક સ્લોગન કહેવા નહીં, જ્યાં સુધી મુમુક્ષુ પહેલા ન કહે.\n\n';

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

async function updateLlmVersion(version) {
    const current = await api('GET', `/get-retell-llm/${llmId}`, null, `?version=${version}`);
    const general_prompt = current.general_prompt?.startsWith(GREETING_RULE)
        ? current.general_prompt
        : GREETING_RULE + (current.general_prompt || '');

    await api('PATCH', `/update-retell-llm/${llmId}`, {
        begin_message: BEGIN_MESSAGE,
        general_prompt,
        start_speaker: 'agent',
    }, `?version=${version}`);

    console.log(`LLM version ${version}: begin_message set to Namaskar greeting`);
}

async function main() {
    if (!apiKey || !agentId) {
        console.error('Set RETELL_API_KEY and RETELL_AGENT_ID in .env');
        process.exit(1);
    }

    try {
        await updateLlmVersion(0);
    } catch (err) {
        if (String(err.message).includes('published LLM')) {
            console.log('LLM version 0 is published — skipped (draft v1 updated instead)');
        } else {
            throw err;
        }
    }

    await updateLlmVersion(1);

    await api('PATCH', `/update-agent/${agentId}`, {
        handbook_config: {
            default_personality: false,
            speech_normalization: false,
            ai_disclosure: true,
        },
    });

    console.log('Agent: default_personality disabled (stops auto religious greetings)');
    console.log('Done. Start a new call to hear the updated greeting.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
