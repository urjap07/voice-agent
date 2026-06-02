/**
 * Reduce agent cutting off / stopping mid-conversation.
 * Run: npm run fix:stability
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const agentId = process.env.RETELL_AGENT_ID;
const apiKey = process.env.RETELL_API_KEY;
const llmId = 'llm_d6d9dfa0e58fcd23a0565f5b4e2b';

const STABILITY_RULES = `વાતચીત સતત અને ધીરજથી ચાલુ રાખો. એક સમયે એક જ સવાલ પૂછો. મુમુક્ષુ બોલતા હોય ત્યારે અટકાવો નહીં.
જવાબ સંપૂર્ણ સાંભળ્યા પછી જ આગળ વધો. end_call ટૂલ માત્ર ત્યારે જ વાપરો જ્યારે બધી બુકિંગ વિગતો મળી ગઈ હોય અને મુમુક્ષુ અલવિદા કહે.

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
        language: 'multi',
        interruption_sensitivity: 0.8,
        responsiveness: 0.65,
        enable_backchannel: true,
        normalize_for_speech: true,
        denoising_mode: 'no-denoise',
        end_call_after_silence_ms: 120000,
        reminder_trigger_ms: 45000,
        reminder_max_count: 2,
    });

    console.log('Agent updated:');
    console.log('  interruption_sensitivity: 0.8 (allows interruption)');
    console.log('  enable_backchannel: true');
    console.log('  language: multi (better for Gujarati)');
    console.log('  denoising: noise-and-background-speech-cancellation');

    const llm = await api('GET', `/get-retell-llm/${llmId}`, null, '?version=1');
    const general_prompt = llm.general_prompt?.includes('end_call ટૂલ')
        ? llm.general_prompt
        : STABILITY_RULES + (llm.general_prompt || '');

    const general_tools = (llm.general_tools || []).map((tool) => {
        if (tool.name === 'end_call') {
            return {
                ...tool,
                description:
                    'End the call ONLY after all booking details are collected, confirmed with the user, and they say goodbye. Never end during data collection or while the user is still speaking.',
            };
        }
        return tool;
    });

    await api('PATCH', `/update-retell-llm/${llmId}`, { general_prompt, general_tools }, '?version=1');
    console.log('LLM updated: stability rules + stricter end_call');

    console.log('\nDone. Hard-refresh browser and start a new call.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
