const axios = require('axios');
require('dotenv').config();

async function testSpeed() {
    const start = Date.now();
    try {
        console.log("Sending direct test request to OpenAI...");
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Say hello in Gujarati.' }
            ],
            temperature: 0.0
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        const duration = Date.now() - start;
        console.log(`Success! Direct API Duration: ${duration}ms`);
        console.log(`Response:`, response.data.choices[0].message.content);
    } catch (e) {
        console.error(`Error:`, e.response ? e.response.data : e.message);
    }
}

testSpeed();
