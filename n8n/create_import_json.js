const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'workflow_voice_agent.json');
const destPath = path.join(__dirname, 'workflow_voice_agent_updated.json');

const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

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

    // 5. Inject chat history expression into AI Agent System Prompt
    if (node.name === 'AI Agent' || node.type === '@n8n/n8n-nodes-langchain.agent') {
        const originalText = node.parameters.text;
        const escapedText = originalText.replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '\\n');
        node.parameters.text = `={{ "${escapedText}" + ($('Webhook').item.json.body.history ? "\\n\\nઆ કૉલનો અગાઉનો ઇતિહાસ:\\n" + $('Webhook').item.json.body.history : "") }}`;
        console.log("Updated AI Agent prompt to inject dynamic history.");
    }
});

// Create the complete workflow structure expected by n8n CLI import
const workflow = {
    id: "kJ6bUz1qrcf2sMO2",
    name: "Voice Agent",
    active: true,
    nodes: data.nodes,
    connections: data.connections
};

fs.writeFileSync(destPath, JSON.stringify(workflow, null, 2));
console.log("Successfully wrote updated workflow to workflow_voice_agent_updated.json.");
