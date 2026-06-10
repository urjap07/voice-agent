const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.HOME || '/Users/Urja', '.n8n', 'database.sqlite'));

const row = db.prepare('SELECT nodes FROM workflow_entity WHERE id = ?').get('kJ6bUz1qrcf2sMO2');
const nodes = JSON.parse(row.nodes);
const normNode = nodes.find(n => n.name === 'Normalize Gujarati Digits');

// Add debug logging to see what $('Webhook') actually returns in the Code node
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

// Try different ways to access Webhook body
let webhookJson = null;
try { webhookJson = $('Webhook').item.json; } catch(e) {}
if (!webhookJson) {
    try { webhookJson = $('Webhook').first().json; } catch(e) {}
}
const body = webhookJson?.body || {};
const history = body.history || '';
const dateParsedMatch = history.match(/System date parser: (start_date=[^,]+, end_date=[^.]+)/);

console.log('[NormDebug] webhookJson keys:', Object.keys(webhookJson || {}));
console.log('[NormDebug] body keys:', Object.keys(body));
console.log('[NormDebug] history length:', history.length);
console.log('[NormDebug] dateParsedMatch:', dateParsedMatch ? dateParsedMatch[1] : 'null');

for (const item of $input.all()) {
    let text = item.json.transcript || "";
    let normalized = text.toLowerCase();
    for (const [word, digit] of Object.entries(map)) {
        normalized = normalized.split(word).join(digit);
    }
    normalized = normalized.replace(/\\b(\\d)\\b\\s+(?=\\b\\d\\b)/g, '$1');

    if (dateParsedMatch) {
        item.json.transcript = '[System: User typed date input. ' + dateParsedMatch[1] + '. These are the confirmed check-in (start_date) and check-out (end_date). Acknowledge dates in Gujarati and ask about meal preferences.]';
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

console.log('Patched with debug logging. Length:', normNode.parameters.jsCode.length);
