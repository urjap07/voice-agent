const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'workflow_voice_agent.json');
const destPath = path.join(__dirname, 'workflow_voice_agent_updated.json');

const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

// Re-configure verify_phone as a MySQL Tool node - disabled to keep it as HTTP Request Tool
// const verifyPhoneIndex = data.nodes.findIndex(node => node.name === 'verify_phone');
// if (verifyPhoneIndex !== -1) {
//     data.nodes[verifyPhoneIndex] = {
//         "parameters": {
//             "descriptionType": "manual",
//             "toolDescription": "Use this tool immediately when the user provides a phone number to check if they are registered. Input parameter: phone_number (string, exactly 10 digits, no country code, no spaces). Returns: name, centre_name, and phone if registered, empty result if not found.",
//             "operation": "executeQuery",
//             "query": "SELECT name, centre_name, phone FROM registered_users WHERE RIGHT(phone, 10) = '{{ $fromAI(\"phone_number\", \"The clean 10-digit mobile number of the user\", \"string\") }}' LIMIT 1",
//             "options": {}
//         },
//         "type": "n8n-nodes-base.mySqlTool",
//         "typeVersion": 1,
//         "position": [
//             464,
//             192
//         ],
//         "id": "0e33dfc5-7be0-4a27-bc31-eba1fcaae1a3",
//         "name": "verify_phone",
//         "credentials": {
//             "mySql": {
//                 "id": "KRaAv6CI6cLNIqg9",
//                 "name": "MySQL account"
//             }
//         }
//     };
//     console.log("Configured verify_phone as MySQL Tool node with correct credential.");
// }

data.nodes.forEach(node => {
    // 1. Update Simple Memory sessionKey expression
    if (node.name === 'Simple Memory' || node.type === '@n8n/n8n-nodes-langchain.memoryBufferWindow') {
        node.parameters.sessionKey = "={{ $('Webhook').item.json.query.sessionId }}";
        console.log("Updated Simple Memory sessionKey expression.");
    }

    // 2. Update Text to speech node parameters
    if (node.name === 'Text to speech' || (node.type === 'n8n-nodes-sarvam.sarvam' && node.parameters && node.parameters.operation === 'textToSpeech')) {
        node.parameters.text = "={{ $json.output.replace(/[^\\x00-\\x7F\\u0A80-\\u0AFF]/g, '') }}";
        node.parameters.ttsTargetLanguage = "gu-IN";
        if (!node.parameters.textToSpeechOptions) {
            node.parameters.textToSpeechOptions = {};
        }
        node.parameters.textToSpeechOptions.output_audio_codec = 'wav';
        node.parameters.textToSpeechOptions.speaker = 'shruti'; // Use shruti (female voice) for bulbul:v3 compatibility
        console.log("Updated Text to speech node.");
    }

    // 3. Update Webhook node parameters to return firstEntryBinary
    if (node.name === 'Webhook' || node.type === 'n8n-nodes-base.webhook') {
        node.parameters.responseData = "firstEntryBinary";
        node.parameters.responseBinaryParameter = "data";
        console.log("Updated Webhook node for binary response.");
    }

    // 4. Update OpenAI model parameter
    if (node.name === 'OpenAI Chat Model' || node.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi') {
        if (node.parameters && node.parameters.model) {
            node.parameters.model.value = "gpt-4o-mini";
            console.log("Updated OpenAI Chat Model to gpt-4o-mini.");
        }
    }

    // 5. Inject chat history and verification details into AI Agent System Prompt
    // 5. Inject chat history and verification details into AI Agent System Prompt
    // Update the AI Agent section (Step 4 in your compiler)
    if (node.name === 'AI Agent') {
        const basePrompt = `તમે શ્રીમદ્ રાજચંદ્ર આત્મ તત્ત્વ રિસર્ચ સેન્ટરના અતિર્તિત સહાયક (Guest Assistant) છો.
તમારે ફક્ત ગુજરાતીમાં જ વાતચીત કરવાની છે. 
સ્ટ્રીક્ટ નિયમો:
- **ગ્રીટિંગ નિયમ:** જો નામ અને સેન્ટર માહિતીમાં મળી જાય, તો તે માહિતીનો ઉપયોગ કરીને ગ્રીટ કરો અને ફરી ક્યારેય સ્વાગત સંદેશ (Welcome Message) બોલવો નહીં.
- જો યુઝર વેરીફાઈડ હોય, તો ફોન નંબર ક્યારેય માંગવો નહીં.
- જો યુઝર અજાણ્યો હોય, તો જ એકવાર સ્વાગત સંદેશ બોલી ફોન નંબર માંગવો.`;

        const injection = `={{ $('Webhook').item.json.query.verified === 'true' ? 
            "\\n\\n[સિસ્ટમ માહિતી: યુઝર વેરીફાઈડ છે. નામ: " + $('Webhook').item.json.query.name + ", સેન્ટર: " + $('Webhook').item.json.query.centre_name + ". તમે આ યુઝરને ઓળખો છો, એટલે સ્વાગત સંદેશ બોલ્યા વગર સીધું જ તેમને પૂછો: 'આપ ક્યારથી ક્યાં સુધી આવવા માંગો છો?']" 
            : "\\n\\n[સિસ્ટમ માહિતી: યુઝર અજાણ્યો છે.]" }}`;

        node.parameters.text = basePrompt + injection;
    }

    // 6. Update verify_phone tool parameters with $fromAI
    if (node.name === 'verify_phone') {
        node.parameters.toolDescription = "Checks if a 10-digit phone number is registered. Call this tool ONLY when the user explicitly provides their phone number. Do NOT call this tool if no phone number has been provided yet.";
        node.parameters.jsonBody = `={
  "phone_number": "{{ $fromAI('phone_number', 'The clean 10-digit mobile number of the user', 'string') }}",
  "sessionId": "{{ $('Webhook').item.json.query.sessionId }}"
}
`;
        console.log("Updated verify_phone tool parameters and description.");
    }

    // 7. Update save_booking tool parameters with $fromAI
    if (node.name === 'save_booking') {
        node.parameters.jsonBody = `={
  "mumukshu_name": "{{ $fromAI('mumukshu_name', 'The guest name retrieved during phone registration', 'string') }}",
  "mumukshu_phone": "{{ $fromAI('mumukshu_phone', 'The 10-digit registered phone number', 'string') }}",
  "start_date": "{{ $fromAI('start_date', 'The check-in/arrival date in YYYY-MM-DD format', 'string') }}",
  "end_date": "{{ $fromAI('end_date', 'The check-out/departure date in YYYY-MM-DD format', 'string') }}",
  "total_persons": {{ $fromAI('total_persons', 'The total number of persons', 'number', 1) }},
  "wants_room": {{ $fromAI('wants_room', 'Boolean indicating if the guest needs accommodation/room', 'boolean', false) }},
  "floor_preference": "{{ $fromAI('floor_preference', 'Floor preference: Ground floor or Any floor', 'string', 'Any floor') }}",
  "has_breakfast": {{ $fromAI('has_breakfast', 'Boolean indicating if breakfast is required', 'boolean', false) }},
  "has_lunch": {{ $fromAI('has_lunch', 'Boolean indicating if lunch is required', 'boolean', false) }},
  "has_dinner": {{ $fromAI('has_dinner', 'Boolean indicating if dinner is required', 'boolean', false) }},
  "dietary_preference": "{{ $fromAI('dietary_preference', 'Dietary preference: Regular or Jain', 'string', 'Regular') }}"
}
`;
        console.log("Updated save_booking tool parameters with $fromAI.");
    }
});

// Create the complete workflow structure expected by n8n CLI import
const codeNode = {
    "parameters": {
        "jsCode": `const map = {
    'શૂન્ય': '0', 'ઝીરો': '0', '૦': '0',
    'એક': '1', '૧': '1',
    'બે': '2', '૨': '2',
    'ત્રણ': '3', '૩': '3',
    'ચાર': '4', '૪': '4',
    'પાંચ': '5', '૫': '5',
    'છ': '6', '૬': '6',
    'સાત': '7', '૭': '7',
    'આઠ': '8', '૮': '8',
    'નવ': '9', '૯': '9'
};

for (const item of $input.all()) {
    let text = item.json.transcript || "";
    let normalized = text.toLowerCase();
    for (const [word, digit] of Object.entries(map)) {
        normalized = normalized.split(word).join(digit);
    }
    // Remove spaces between numbers
    normalized = normalized.replace(/(\\d)\\s+(?=\\d)/g, '$1');
    item.json.transcript = normalized;
}
return $input.all();`
    },
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [
        100,
        16
    ],
    "id": "e9b25123-5e92-411a-a28c-7f5b3a241cb1",
    "name": "Normalize Gujarati Digits"
};
data.nodes.push(codeNode);

if (data.connections['Speech to text'] && data.connections['Speech to text'].main) {
    data.connections['Speech to text'].main = [
        [
            {
                "node": "Normalize Gujarati Digits",
                "type": "main",
                "index": 0
            }
        ]
    ];
}
data.connections['Normalize Gujarati Digits'] = {
    "main": [
        [
            {
                "node": "AI Agent",
                "type": "main",
                "index": 0
            }
        ]
    ]
};

const workflow = {
    id: "kJ6bUz1qrcf2sMO2",
    name: "Voice Agent",
    active: true,
    nodes: data.nodes,
    connections: data.connections
};

fs.writeFileSync(destPath, JSON.stringify(workflow, null, 2));
console.log("Successfully wrote updated workflow to workflow_voice_agent_updated.json.");
