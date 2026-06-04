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
        node.parameters.text = "={{ $json.output }}";
        node.parameters.ttsTargetLanguage = "gu-IN";
        if (!node.parameters.textToSpeechOptions) {
            node.parameters.textToSpeechOptions = {};
        }
        node.parameters.textToSpeechOptions.output_audio_codec = 'wav';
        node.parameters.textToSpeechOptions.speaker = 'anushka'; // Keep speaker as anushka (female voice)
        console.log("Updated Text to speech node.");
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
