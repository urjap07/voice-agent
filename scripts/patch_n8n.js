const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.HOME || '/Users/Urja', '.n8n', 'database.sqlite'));

const row = db.prepare('SELECT nodes FROM workflow_entity WHERE id = ?').get('kJ6bUz1qrcf2sMO2');
const nodes = JSON.parse(row.nodes);

// ── FIX 1: Normalize Gujarati Digits ─────────────────────────────────────────
// Inject parsed date hint into `transcript` (the field the AI Agent actually reads).
// The TTS→STT round-trip turns "11 June 2026" into garbled Gujarati compound words
// like "અગિયાર જૂન 2 હ 6વ્વીસ" which GPT-4o-mini cannot reliably parse as a date.
// When server.js has pre-parsed the date, we override the garbled transcript with
// a clean English instruction so the AI Agent gets unambiguous date values.

const normCode = `const map = {
    'શૂન્ય': '0', 'ઝીરો': '0', '૦': '0',
    'એક': '1', '૧': '1', 'વન': '1',
    'બે': '2', '૨': '2', 'ટુ': '2', 'ટૂ': '2',
    'ત્રણ': '3', '૩': '3', 'થ્રી': '3',
    'ચાર': '4', '૪': '4', 'ફોર': '4',
    'પાંચ': '5', '૫': '5', 'ફાઇવ': '5', 'ફાઈવ': '5',
    'છ': '6', '૬': '6', 'સિક્સ': '6',
    'સાત': '7', '૭': '7', 'સેવન': '7',
    'આઠ': '8', '૮': '8', 'એટ': '8',
    'નવ': '9', '૯': '9', 'નાઇન': '9', 'નાઈન': '9'
};

// Read the webhook body to find server.js pre-parsed date hint
const webhookBody = $('Webhook').item.json.body || {};
const history = webhookBody.history || '';
const dateParsedMatch = history.match(/System date parser: (start_date=[^,]+, end_date=[^.]+)/);

for (const item of $input.all()) {
    let text = item.json.transcript || "";
    let normalized = text.toLowerCase();
    for (const [word, digit] of Object.entries(map)) {
        normalized = normalized.split(word).join(digit);
    }
    // Only merge isolated single digits (phone number pattern "9 8 8 3...").
    // Word-boundary guards prevent merging multi-digit date numbers like "11 13".
    normalized = normalized.replace(/\\b(\\d)\\b\\s+(?=\\b\\d\\b)/g, '$1');

    if (dateParsedMatch) {
        // Override garbled Gujarati date words with clean parsed dates.
        // GPT-4o-mini cannot reliably decode "2 h 6vvis" back to "2026".
        item.json.transcript = '[System: User typed date input. ' + dateParsedMatch[1] + '. These are the confirmed check-in (start_date) and check-out (end_date). Acknowledge the dates in Gujarati and ask about meal preferences.]';
    } else {
        item.json.transcript = normalized;
    }
}
return $input.all();`;

const normNode = nodes.find(n => n.name === 'Normalize Gujarati Digits');
normNode.parameters.jsCode = normCode;

// ── FIX 2: Verify system prompt has no-re-greeting guard ────────────────────
const agentNode = nodes.find(n => n.type === '@n8n/n8n-nodes-langchain.agent');
const hasGuard = agentNode.parameters.text.includes('greeting already given');
console.log('System prompt guard present:', hasGuard);

// Apply DB update
db.prepare('UPDATE workflow_entity SET nodes = ?, updatedAt = ? WHERE id = ?').run(
    JSON.stringify(nodes),
    new Date().toISOString(),
    'kJ6bUz1qrcf2sMO2'
);

// Verify saved code
const row2 = db.prepare('SELECT nodes FROM workflow_entity WHERE id = ?').get('kJ6bUz1qrcf2sMO2');
const saved = JSON.parse(row2.nodes).find(n => n.name === 'Normalize Gujarati Digits');
console.log('Normalize code saved, length:', saved.parameters.jsCode.length);
console.log('Has dateParsedMatch logic:', saved.parameters.jsCode.includes('dateParsedMatch'));
console.log('Uses transcript override:', saved.parameters.jsCode.includes('System: User typed date'));
