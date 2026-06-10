const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.HOME || '/Users/Urja', '.n8n', 'database.sqlite'));

const row = db.prepare('SELECT nodes FROM workflow_entity WHERE id = ?').get('kJ6bUz1qrcf2sMO2');
const nodes = JSON.parse(row.nodes);
const normNode = nodes.find(n => n.name === 'Normalize Gujarati Digits');

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

const webhookJson = $('Webhook').item.json;
const query = webhookJson.query || {};
const startDate = query.start_date || '';
const endDate = query.end_date || '';

// Log to n8n process stdout for debugging
console.log('[NormFinal] webhookJson keys:', JSON.stringify(Object.keys(webhookJson)));
console.log('[NormFinal] query:', JSON.stringify(query));
console.log('[NormFinal] startDate:', startDate, '| endDate:', endDate);

for (const item of $input.all()) {
    let text = item.json.transcript || "";
    let normalized = text.toLowerCase();
    for (const [word, digit] of Object.entries(map)) {
        normalized = normalized.split(word).join(digit);
    }
    normalized = normalized.replace(/\\b(\\d)\\b\\s+(?=\\b\\d\\b)/g, '$1');

    if (startDate && endDate) {
        item.json.transcript = '[System: User provided check-in date ' + startDate + ' and check-out date ' + endDate + '. Confirm these dates in Gujarati and ask about meal preferences. Do not ask for dates again.]';
        console.log('[NormFinal] Overrode transcript with date injection');
    } else {
        item.json.transcript = normalized;
        console.log('[NormFinal] Using normalized transcript (no dates in query)');
    }
}
return $input.all();`;

db.prepare('UPDATE workflow_entity SET nodes = ?, updatedAt = ? WHERE id = ?').run(
    JSON.stringify(nodes),
    new Date().toISOString(),
    'kJ6bUz1qrcf2sMO2'
);
console.log('Debug2 patch applied. Code length:', normNode.parameters.jsCode.length);
