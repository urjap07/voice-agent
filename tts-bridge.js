require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const app     = express();

app.use(express.json());

app.post('/sarvam-tts', async (req, res) => {
  const text = req.body.text || '';
  console.log('[Sarvam TTS]:', text.slice(0, 80));

  try {
    const response = await axios.post(
      'https://api.sarvam.ai/text-to-speech',
      {
        inputs: [text],
        target_language_code: 'gu-IN',
        speaker: 'anushka',
        model: 'bulbul:v3-beta',
        pace: 1.0,
        enable_preprocessing: true,
      },
      {
        headers: {
          'api-subscription-key': process.env.SARVAM_API_KEY,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
      }
    );

    const pcm = Buffer.from(response.data).slice(44);
    res.set('Content-Type', 'audio/pcm');
    res.send(pcm);

  } catch (err) {
    console.error('[Sarvam TTS] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () =>
  console.log('✅ Sarvam TTS bridge running on http://localhost:3001')
);