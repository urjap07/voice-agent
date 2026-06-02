/**
 * Fix long pause after greeting — ask name immediately in begin_message.
 * Run: npm run fix:greeting-flow
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const agentId = process.env.RETELL_AGENT_ID;
const apiKey = process.env.RETELL_API_KEY;
const llmId = 'llm_d6d9dfa0e58fcd23a0565f5b4e2b';

// Spoken in one shot — no wait for LLM before first question
const BEGIN_MESSAGE =
    'નમસ્કાર! શ્રીમદ રાજચંદ્ર આત્મ તત્વ રિસર્ચ સેન્ટરમાં આપનું સ્વાગત છે. હું તમારી બુકિંગ માટે મદદ કરીશ. કૃપા કરીને તમારું નામ કહો.';

const FLOW_RULES = `પહેલો સવાલ મુમુક્ષુનું નામ પૂછવાનો જ રહે. એક સવાલ પૂછો, જવાબ પૂરો થાય એટલે જ આગળ વધો.

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

async function main() {
    if (!apiKey || !agentId) {
        console.error('Set RETELL_API_KEY and RETELL_AGENT_ID in .env');
        process.exit(1);
    }

    await api('PATCH', `/update-agent/${agentId}`, {
        responsiveness: 0.35,
        interruption_sensitivity: 0.8,
        stt_mode: 'accurate',
        reminder_trigger_ms: 30000,
        reminder_max_count: 1,
        enable_backchannel: true,
    });

    const llm = await api('GET', `/get-retell-llm/${llmId}`, null, '?version=1');
    let general_prompt = llm.general_prompt || '';
    if (!general_prompt.includes('2 સેકંડથી વધુ')) {
        general_prompt = FLOW_RULES + general_prompt;
    }

    await api(
        'PATCH',
        `/update-retell-llm/${llmId}`,
        {
            begin_message: BEGIN_MESSAGE,
            start_speaker: 'agent',
            general_prompt,
        },
        '?version=1'
    );

    console.log('Updated begin_message (asks name immediately):');
    console.log(BEGIN_MESSAGE);
    console.log('\nAgent responsiveness: 1 (faster replies)');
    console.log('Start a NEW call to hear the change.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
