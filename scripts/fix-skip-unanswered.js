/**
 * TESTING ONLY: skip unanswered questions after 2 tries.
 * Conflicts with original flow — use npm run fix:require-answer instead.
 * Run: npm run fix:skip-unanswered
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const apiKey = process.env.RETELL_API_KEY;
const llmId = 'llm_d6d9dfa0e58fcd23a0565f5b4e2b';

const SKIP_RULES = `સવાલ જવાબ વગર આગળ વધો (ટેસ્ટિંગ):
- દરેક સવાલ માટે મહત્તમ 2 વાર પૂછો. બીજી વાર પણ જવાબ ન મળે તો "ઠીક છે, આગળ વધીએ" કહીને તરત આગલો સવાલ પૂછો.
- એક જ સવાલ પર 2 મિનિટથી વધુ અટકો નહીં.
- જેનો જવાબ ન મળે તે ખાલી છોડી બાકી બધા સવાલો પૂછો.

સવાલોનો ક્રમ (આ ક્રમમાં જ પૂછો):
1) નામ  2) ફોન નંબર  3) આગમન તારીખ  4) જવાની તારીખ  5) કુલ વ્યક્તિઓ
6) રૂમ જોઈએ કે નહીં (હા/ના)  7) ફ્લોર પસંદગી  8) શિબિર  9) બ્રેકફાસ્ટ  10) લંચ  11) ડિનર  12) આહાર પસંદગી

`;

async function main() {
    if (!apiKey) {
        console.error('Set RETELL_API_KEY in .env');
        process.exit(1);
    }

    const res = await fetch(`https://api.retellai.com/get-retell-llm/${llmId}?version=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    const llm = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(llm));

    let general_prompt = llm.general_prompt || '';
    if (!general_prompt.includes('સવાલ જવાબ વગર આગળ વધો')) {
        general_prompt = SKIP_RULES + general_prompt;
    }

    const patchRes = await fetch(`https://api.retellai.com/update-retell-llm/${llmId}?version=1`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ general_prompt }),
    });
    const patchData = await patchRes.json();
    if (!patchRes.ok) throw new Error(JSON.stringify(patchData));

    console.log('LLM updated: skip unanswered questions after 2 tries, then next question.');
    console.log('Start a NEW call to test.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
