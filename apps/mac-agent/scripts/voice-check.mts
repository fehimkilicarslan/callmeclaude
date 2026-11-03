import { GoogleGenAI, Modality } from '@google/genai';
import { getSecret } from '../src/secrets.ts';
const ai = new GoogleGenAI({ apiKey: getSecret('gemini-api-key')! });
const t0 = Date.now(); let first = 0, bytes = 0, text = '';
const done = new Promise<void>((res) => setTimeout(res, 15000));
const s = await ai.live.connect({
  model: process.argv[2] ?? 'gemini-3.8-live',
  config: { responseModalities: [Modality.AUDIO], outputAudioTranscription: {}, systemInstruction: 'Answer in one short sentence.' },
  callbacks: {
    onopen: () => console.log('open', Date.now() - t0, 'ms'),
    onmessage: (m: any) => {
      for (const p of m.serverContent?.modelTurn?.parts ?? []) if (p.inlineData?.data) { if (!first) first = Date.now(); bytes += Buffer.from(p.inlineData.data, 'base64').length; }
      if (m.serverContent?.outputTranscription?.text) text += m.serverContent.outputTranscription.text;
      if (m.serverContent?.turnComplete) { console.log('turnComplete; first audio after', first - sent, 'ms; audio bytes', bytes, 'mime ok; text:', text); process.exit(0); }
    },
    onerror: (e: any) => console.log('error', e?.message ?? e),
    onclose: (e: any) => { console.log('close', e?.code, e?.reason); process.exit(1); },
  },
});
const sent = Date.now();
s.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'Hi, introduce yourself.' }] }], turnComplete: true });
await done; console.log('timeout'); process.exit(1);
