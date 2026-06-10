const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.HOME || '/Users/Urja', '.n8n', 'database.sqlite'));

const row = db.prepare('SELECT nodes FROM workflow_entity WHERE id = ?').get('kJ6bUz1qrcf2sMO2');
const nodes = JSON.parse(row.nodes);
const normNode = nodes.find(n => n.name === 'Normalize Gujarati Digits');

// Debug: write the webhook body to the item JSON so we can inspect it in execution data
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

// Debug: capture what the Code node can actually see from the Webhook
let dbgWebhookItem = null;
let dbgWebhookFirst = null;
try { dbgWebhookItem = $('Webhook').item.json; } catch(e) { dbgWebhookItem = {err: e.message}; }
try { dbgWebhookFirst = $('Webhook').first().json; } catch(e) { dbgWebhookFirst = {err: e.message}; }

for (const item of $input.all()) {
    let text = item.json.transcript || "";
    let normalized = text.toLowerCase();
    for (const [word, digit] of Object.entries(map)) {
        normalized = normalized.split(word).join(digit);
    }
    normalized = normalized.replace(/\\b(\\d)\\b\\s+(?=\\b\\d\\b)/g, '$1');
    item.json.transcript = normalized;
    // Store debug info so we can see it in execution data
    item.json._dbg_item_body_keys = Object.keys(dbgWebhookItem?.body || {});
    item.json._dbg_item_history_len = (dbgWebhookItem?.body?.history || '').length;
    item.json._dbg_first_body_keys = Object.keys(dbgWebhookFirst?.body || {});
    item.json._dbg_first_history_len = (dbgWebhookFirst?.body?.history || '').length;
    item.json._dbg_item_err = dbgWebhookItem?.err || null;
    item.json._dbg_first_err = dbgWebhookFirst?.err || null;
}
return $input.all();`;

db.prepare('UPDATE workflow_entity SET nodes = ?, updatedAt = ? WHERE id = ?').run(
    JSON.stringify(nodes),
    new Date().toISOString(),
    'kJ6bUz1qrcf2sMO2'
);
console.log('Debug patch applied');
