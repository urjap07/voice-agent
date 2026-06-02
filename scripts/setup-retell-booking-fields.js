/**
 * Configure Retell agent: post-call fields + webhook + LLM booking instructions.
 * Run: npm run setup:retell
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const agentId = process.env.RETELL_AGENT_ID;
const apiKey = process.env.RETELL_API_KEY;
const webhookBase = process.env.WEBHOOK_BASE_URL || 'http://localhost:3000';
const llmId = 'llm_d6d9dfa0e58fcd23a0565f5b4e2b';

const postCallAnalysisData = [
    { type: 'string', name: 'mumukshu_name', description: 'Full name of the guest (mumukshu).' },
    { type: 'string', name: 'mumukshu_phone', description: 'Guest phone number.' },
    { type: 'string', name: 'start_date', description: 'Check-in date YYYY-MM-DD.' },
    { type: 'string', name: 'end_date', description: 'Check-out date YYYY-MM-DD.' },
    { type: 'number', name: 'total_persons', description: 'Total number of persons.' },
    { type: 'boolean', name: 'wants_room', description: 'Whether guest wants a room.' },
    { type: 'string', name: 'floor_preference', description: 'Ground floor or any floor.' },
    { type: 'string', name: 'booked_shibir', description: 'Shibir/camp name if booked.' },
    { type: 'boolean', name: 'has_breakfast', description: 'Breakfast requested.' },
    { type: 'boolean', name: 'has_lunch', description: 'Lunch requested.' },
    { type: 'boolean', name: 'has_dinner', description: 'Dinner requested.' },
    { type: 'string', name: 'dietary_preference', description: 'Regular, Jain, Swaminarayan, etc.' },
];

const BOOKING_RULES = `બુકિંગ માટે આ બધી વિગતો ચોક્કસ પૂછો અને કન્ફર્મ કરો પછી જ કૉલ બંધ કરો:
1) mumukshu_name 2) mumukshu_phone 3) start_date 4) end_date 5) total_persons
6) wants_room અને floor_preference (જો રૂમ જોઈએ) 7) booked_shibir (જો શિબિર હોય)
8) has_breakfast, has_lunch, has_dinner 9) dietary_preference
તારીખો YYYY-MM-DD ફોર્મેટમાં બોલો. બધું મળ્યા પછી સારાંશ વાંચીને કન્ફર્મ કરાવો.

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

async function updateLlmPrompt() {
    try {
        const current = await api('GET', `/get-retell-llm/${llmId}`, null, '?version=1');
        const general_prompt = current.general_prompt?.includes('mumukshu_name')
            ? current.general_prompt
            : BOOKING_RULES + (current.general_prompt || '');

        await api('PATCH', `/update-retell-llm/${llmId}`, { general_prompt }, '?version=1');
        console.log('LLM: booking collection rules added');
    } catch (err) {
        console.warn('LLM update skipped:', err.message);
    }
}

async function main() {
    if (!apiKey || !agentId) {
        console.error('Set RETELL_API_KEY and RETELL_AGENT_ID in .env');
        process.exit(1);
    }

    await api('PATCH', `/update-agent/${agentId}`, {
        post_call_analysis_data: postCallAnalysisData,
        webhook_url: `${webhookBase.replace(/\/$/, '')}/webhook/retell`,
        webhook_events: ['call_analyzed'],
    });

    console.log('Agent: post-call fields + webhook configured');
    console.log('Fields:', postCallAnalysisData.map((f) => f.name).join(', '));

    await updateLlmPrompt();

    console.log('\nAfter each call, booking saves to MySQL booking_system.bookings');
    console.log('Local: browser auto-saves via POST /api/bookings/finalize');
    console.log('Production webhook: use ngrok + WEBHOOK_BASE_URL in .env, then re-run this script');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
