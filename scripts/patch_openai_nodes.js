const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.HOME || '/Users/Urja', '.n8n', 'database.sqlite'));

const row = db.prepare('SELECT nodes, versionId FROM workflow_entity WHERE id = ?').get('kJ6bUz1qrcf2sMO2');
const nodes = JSON.parse(row.nodes);
const versionId = row.versionId;

// Fix STT node — binary file upload, no language param (gu not supported by Whisper)
const sttNode = nodes.find(n => n.name === 'Speech to Text');
sttNode.parameters.bodyParameters = {
    parameters: [
        {
            parameterType: 'formBinaryData',
            name: 'file',
            inputDataFieldName: 'data'
        },
        {
            name: 'model',
            value: 'whisper-1'
        }
    ]
};
console.log('STT node file parameter set to formBinaryData (no language param)');

// Fix TTS node — remove leading space from URL
const ttsNode = nodes.find(n => n.name === 'Text to Speech');
ttsNode.parameters.url = ttsNode.parameters.url.trim();
console.log('TTS URL fixed:', ttsNode.parameters.url);

// Fix Normalize code node — add Devanagari digit mappings
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
    'નવ': '9', '૯': '9', 'નાઇન': '9', 'નાઈન': '9',
    'शून्य': '0', 'शुन्य': '0',
    'एक': '1',
    'दो': '2', 'बे': '2',
    'तीन': '3', 'त्रण': '3', 'त्रन्च': '3',
    'चार': '4',
    'पाँच': '5', 'पांच': '5',
    'छह': '6', 'छे': '6',
    'सात': '7',
    'आटू': '8', 'आठ': '8', 'आट': '8',
    'नौ': '9', 'नव': '9',
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
    '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
};

const webhookJson = $('Webhook').item.json;
const query = webhookJson.query || {};
const startDate = query.start_date || '';
const endDate = query.end_date || '';

// Use $input.first() and return new JSON only (avoids binary data serialization in task runner)
const firstItem = $input.first();
const text = (firstItem.json.transcript || firstItem.json.text || "");
let normalized = text.toLowerCase();
for (const [word, digit] of Object.entries(map)) {
    normalized = normalized.split(word).join(digit);
}
normalized = normalized.replace(/\\b(\\d)\\b\\s+(?=\\b\\d\\b)/g, '$1');

let transcript;
if (startDate && endDate) {
    transcript = '[System: User provided check-in date ' + startDate + ' and check-out date ' + endDate + '. Confirm these dates in Gujarati and ask about meal preferences. Do not ask for dates again.]';
} else {
    transcript = normalized;
}
return [{ json: { transcript } }];`;
console.log('Normalize Gujarati Digits updated with Devanagari mappings');

const nodesJson = JSON.stringify(nodes);

// Update workflow_entity
db.prepare('UPDATE workflow_entity SET nodes = ?, updatedAt = ? WHERE id = ?').run(
    nodesJson,
    new Date().toISOString(),
    'kJ6bUz1qrcf2sMO2'
);

// CRITICAL: Also update workflow_history (n8n uses this for execution snapshots)
const updated = db.prepare('UPDATE workflow_history SET nodes = ? WHERE workflowId = ? AND versionId = ?').run(
    nodesJson,
    'kJ6bUz1qrcf2sMO2',
    versionId
);
console.log('workflow_entity updated. workflow_history rows updated:', updated.changes, '(versionId:', versionId + ')');

// Verify
const saved = JSON.parse(db.prepare('SELECT nodes FROM workflow_entity WHERE id = ?').get('kJ6bUz1qrcf2sMO2').nodes);
const sttSaved = saved.find(n => n.name === 'Speech to Text');
const ttsSaved = saved.find(n => n.name === 'Text to Speech');
console.log('STT params:', JSON.stringify(sttSaved.parameters.bodyParameters.parameters));
console.log('TTS URL:', ttsSaved.parameters.url);
console.log('Done.');
