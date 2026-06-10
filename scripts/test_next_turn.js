require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

async function runTest() {
    try {
        const textToSpeak = "10 to 15 June";
        // Re-use the session ID from the previous run
        const testSessionId = process.argv[2];
        if (!testSessionId) {
            console.error("Please provide a sessionId as an argument.");
            process.exit(1);
        }
        console.log(`Using Session ID: ${testSessionId}`);

        // 1. Generate speech via Sarvam AI
        console.log("Calling Sarvam AI TTS to generate date speech...");
        const ttsRes = await axios.post('https://api.sarvam.ai/text-to-speech', {
            inputs: [textToSpeak],
            target_language_code: 'gu-IN',
            speaker: 'anushka',
            model: 'bulbul:v2'
        }, {
            headers: {
                'api-subscription-key': process.env.SARVAM_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (!ttsRes.data || !ttsRes.data.audios || !ttsRes.data.audios[0]) {
            throw new Error("Failed to get audio from Sarvam TTS");
        }

        const audioBuffer = Buffer.from(ttsRes.data.audios[0], 'base64');
        const dateWavPath = path.join(__dirname, 'date_turn.wav');
        fs.writeFileSync(dateWavPath, audioBuffer);
        console.log(`Generated test date speech and saved to: ${dateWavPath}`);

        // 2. Send to Express endpoint /api/voice-booking
        console.log("Sending audio turn to local server /api/voice-booking...");
        const formData = new FormData();
        formData.append('data', audioBuffer, { filename: 'date_turn.wav', contentType: 'audio/wav' });

        const serverUrl = `http://localhost:3000/api/voice-booking?sessionId=${testSessionId}`;
        const response = await axios.post(serverUrl, formData, {
            headers: {
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer'
        });

        console.log("Response Status:", response.status);
        console.log("Response Headers:", response.headers);

        const responseAudioPath = path.join(__dirname, 'agent_response_dates.wav');
        fs.writeFileSync(responseAudioPath, Buffer.from(response.data));
        console.log(`Saved agent response audio to: ${responseAudioPath}`);

        // 3. Print the text response from n8n DB
        console.log("Done! Run print_latest_execs to see the agent response text.");

    } catch (err) {
        console.error("Test failed:", err.message);
        if (err.response && err.response.data) {
            console.error("Error response:", Buffer.isBuffer(err.response.data) ? err.response.data.toString() : err.response.data);
        }
    }
}

runTest();
