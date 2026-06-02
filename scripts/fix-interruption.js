/**
 * Restore user interruption capability and ensure the agent converses continuously.
 * Run: npm run fix:interruption
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const agentId = process.env.RETELL_AGENT_ID;
const apiKey = process.env.RETELL_API_KEY;
const llmId = 'llm_d6d9dfa0e58fcd23a0565f5b4e2b';

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

    // Update agent settings to allow user interruption (sensitivity: 0.8) and keep responsiveness high (responsiveness: 0.6)
    await api('PATCH', `/update-agent/${agentId}`, {
        interruption_sensitivity: 0.8,
        responsiveness: 0.6,
        enable_backchannel: true, // Backchannel helps make conversation feel continuous
    });

    console.log('Agent updated for continuous conversation:');
    console.log('  interruption_sensitivity: 0.8 (user can interrupt agent)');
    console.log('  responsiveness: 0.6 (faster response to user input)');
    console.log('  enable_backchannel: true (natural listening sounds)');

    // Fetch the LLM to verify or update prompt instructions if needed
    const llm = await api('GET', `/get-retell-llm/${llmId}`, null, '?version=1');
    let general_prompt = llm.general_prompt || '';

    // If the prompt instructs the agent never to interrupt or get stuck, we can supplement it
    const CONTINUOUS_CONVERSATION_RULE = `અવાજ અથવા વિક્ષેપ (interruption) થાય ત્યારે:
- જો મુમુક્ષુ તમને અધવચ્ચે અટકાવે, તો તરત જ બોલવાનું બંધ કરો અને તેમનો પ્રશ્ન/જવાબ સાંભળો.
- વાતચીત અટકાવ્યા વગર સતત ચાલુ રાખો.

`;

    if (!general_prompt.includes('અવાજ અથવા વિક્ષેપ')) {
        general_prompt = CONTINUOUS_CONVERSATION_RULE + general_prompt;
        await api('PATCH', `/update-retell-llm/${llmId}`, { general_prompt }, '?version=1');
        console.log('LLM general prompt updated with continuous conversation rules.');
    } else {
        console.log('LLM prompt already contains continuous conversation rules.');
    }

    console.log('\nDone. Restart the call and verify.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
