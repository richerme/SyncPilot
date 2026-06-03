import { GoogleGenAI } from '@google/genai'

export type TTSVoice = 'nova' | 'alloy' | 'echo' | 'fable' | 'onyx' | 'shimmer'

// Mapeo de las voces históricas (estilo OpenAI) a voces prebuilt de Gemini TTS.
const VOICE_MAP: Record<TTSVoice, string> = {
  nova:    'Kore',   // cálida
  alloy:   'Puck',   // neutral
  echo:    'Charon',
  fable:   'Aoede',
  onyx:    'Fenrir',
  shimmer: 'Leda',   // suave
}

let client: GoogleGenAI | null = null
function getAI(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada')
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  return client
}

// Gemini TTS devuelve PCM crudo (audio/L16, 24kHz, 16-bit, mono). Lo envolvemos
// en un contenedor WAV para que el navegador lo reproduzca con <audio>.
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate   = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)              // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// Devuelve audio WAV (audio/wav). Antes era MP3 vía OpenAI; se migró a Gemini
// porque la cuenta de OpenAI no tiene cuota.
export async function synthesizeSpeech(
  text: string,
  voice: TTSVoice = 'nova',
): Promise<Buffer> {
  const ai = getAI()
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: text.slice(0, 4096) }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_MAP[voice] ?? 'Kore' } } },
    },
  })

  const data = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
  if (!data) throw new Error('Gemini TTS no devolvió audio')
  return pcmToWav(Buffer.from(data, 'base64'))
}
