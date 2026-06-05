require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

async function runTest() {
    try {
        const textToSpeak = "નવ આઠ આઠ ત્રણ છ છ આઠ ત્રણ ત્રણ શૂન્ય"; // 9883636830 in Gujarati
        const testSessionId = `test_voice_${Date.now()}`;
        console.log(`Using Session ID: ${testSessionId}`);

        // 0. Initialize call and get welcome speech from n8n
        console.log("Calling /api/voice-welcome to initialize session and get welcome audio...");
        const welcomeRes = await axios.get(`http://localhost:3000/api/voice-welcome?sessionId=${testSessionId}`, {
            responseType: 'arraybuffer'
        });
        console.log(`Received welcome audio buffer size: ${welcomeRes.data.length} bytes`);
        const welcomeWavPath = path.join(__dirname, 'welcome_from_n8n.wav');
        fs.writeFileSync(welcomeWavPath, Buffer.from(welcomeRes.data));
        console.log(`Saved welcome audio to: ${welcomeWavPath}`);

        console.log("Sleeping for 5 seconds to let welcome execution finish writing to DB...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 1. Generate speech via Sarvam AI
        console.log("Calling Sarvam AI TTS to generate phone number speech...");
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
        const phoneWavPath = path.join(__dirname, 'phone_turn.wav');
        fs.writeFileSync(phoneWavPath, audioBuffer);
        console.log(`Generated test phone speech and saved to: ${phoneWavPath}`);

        // 2. Send to Express endpoint /api/voice-booking
        console.log("Sending audio turn to local server /api/voice-booking...");
        const formData = new FormData();
        formData.append('data', audioBuffer, { filename: 'turn.wav', contentType: 'audio/wav' });

        const serverUrl = `http://localhost:3000/api/voice-booking?sessionId=${testSessionId}`;
        const response = await axios.post(serverUrl, formData, {
            headers: {
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer'
        });

        console.log("Response Status:", response.status);
        console.log("Response Headers:", response.headers);

        const responseAudioPath = path.join(__dirname, 'agent_response.wav');
        fs.writeFileSync(responseAudioPath, Buffer.from(response.data));
        console.log(`Saved agent response audio to: ${responseAudioPath}`);

        // 3. Check session state in backend
        console.log("Done! Check if n8n triggered verify-phone and backend responded successfully.");

    } catch (err) {
        console.error("Test failed:", err.message);
        if (err.response && err.response.data) {
            console.error("Error response:", Buffer.isBuffer(err.response.data) ? err.response.data.toString() : err.response.data);
        }
    }
}

runTest();
