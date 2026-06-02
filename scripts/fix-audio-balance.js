/**
 * Balance: hear slow speech + move on if no answer + avoid long dead air.
 * Run: npm run fix:audio-balance
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const agentId = process.env.RETELL_AGENT_ID;
const apiKey = process.env.RETELL_API_KEY;

async function main() {
    const res = await fetch(`https://api.retellai.com/update-agent/${agentId}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            responsiveness: 0.45,
            interruption_sensitivity: 0.8,
            stt_mode: 'accurate',
            denoising_mode: 'no-denoise',
            enable_backchannel: true,
            reminder_trigger_ms: 25000,
            reminder_max_count: 2,
        }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));

    console.log('Balanced audio settings applied:');
    console.log('  responsiveness: 0.45 (not too slow, not too fast)');
    console.log('  interruption_sensitivity: 0.8');
    console.log('  reminder after 25s silence → agent speaks again');
    console.log('\nSpeak clearly toward mic. Short pauses OK between words.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
