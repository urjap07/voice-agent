require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

async function testSTT() {
    try {
        const audioPath = path.join(__dirname, 'phone_turn.wav');
        console.log(`Transcribing WAV audio file with webm headers: ${audioPath}`);
        
        const fileBuffer = fs.readFileSync(audioPath);
        
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: 'voice_booking.webm',
            contentType: 'audio/webm'
        });
        formData.append('model', 'saaras:v3');
        formData.append('language_code', 'gu-IN');

        const response = await axios.post('https://api.sarvam.ai/speech-to-text', formData, {
            headers: {
                'api-subscription-key': process.env.SARVAM_API_KEY,
                ...formData.getHeaders()
            }
        });

        console.log("Response Status:", response.status);
        console.log("Response Data:", JSON.stringify(response.data, null, 2));

    } catch (err) {
        console.error("STT directly failed:", err.message);
        if (err.response && err.response.data) {
            console.error("Error response:", err.response.data.toString());
        }
    }
}
testSTT();
