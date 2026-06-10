const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.HOME || '/Users/Urja', '.n8n', 'database.sqlite'));

const row = db.prepare('SELECT nodes FROM workflow_entity WHERE id = ?').get('kJ6bUz1qrcf2sMO2');
const nodes = JSON.parse(row.nodes);
const normNode = nodes.find(n => n.name === 'Normalize Gujarati Digits');

// Query params ARE accessible via $('Webhook').item.json.query (confirmed — Simple Memory uses .query.sessionId).
// Form body fields are NOT accessible from Code nodes.
// Server.js now adds start_date/end_date as query params when a date range is typed.
normNode.parameters.jsCode = `const map = {
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

// Read pre-parsed dates from query params (set by server.js when user types a date range).
// Query params are accessible here; form body fields are not.
const query = $('Webhook').item.json.query || {};
const startDate = query.start_date || '';
const endDate = query.end_date || '';

for (const item of $input.all()) {
    let text = item.json.transcript || "";
    let normalized = text.toLowerCase();
    for (const [word, digit] of Object.entries(map)) {
        normalized = normalized.split(word).join(digit);
    }
    // Only merge isolated single digits (phone numbers "9 8 8 3...").
    // Word-boundary guards prevent merging multi-digit date numbers like "11 13".
    normalized = normalized.replace(/\\b(\\d)\\b\\s+(?=\\b\\d\\b)/g, '$1');

    if (startDate && endDate) {
        // Bypass the garbled Gujarati TTS→STT output and give the AI Agent clean date values.
        // The TTS→STT round-trip converts "11 June 2026" → "અગિયાર જૂન 2 હ 6વ્વીસ" which GPT cannot parse.
        item.json.transcript = '[System: User provided check-in date ' + startDate + ' and check-out date ' + endDate + '. Confirm these dates in Gujarati and ask about meal preferences. Do not ask for dates again.]';
    } else {
        item.json.transcript = normalized;
    }
}
return $input.all();`;

db.prepare('UPDATE workflow_entity SET nodes = ?, updatedAt = ? WHERE id = ?').run(
    JSON.stringify(nodes),
    new Date().toISOString(),
    'kJ6bUz1qrcf2sMO2'
);

// Verify
const saved = JSON.parse(db.prepare('SELECT nodes FROM workflow_entity WHERE id = ?').get('kJ6bUz1qrcf2sMO2').nodes)
    .find(n => n.name === 'Normalize Gujarati Digits');
console.log('Code saved, length:', saved.parameters.jsCode.length);
console.log('Uses query params:', saved.parameters.jsCode.includes('query.start_date'));
console.log('Has transcript override:', saved.parameters.jsCode.includes('[System: User provided check-in'));
