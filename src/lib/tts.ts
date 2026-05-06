import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export type TTSVoice = 'nova' | 'alloy' | 'echo' | 'fable' | 'onyx' | 'shimmer'

export async function synthesizeSpeech(
  text: string,
  voice: TTSVoice = 'nova',
): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model:           'tts-1',
    voice,
    input:           text.slice(0, 4096), // límite de OpenAI TTS
    response_format: 'mp3',
    speed:           1.0,
  })
  return Buffer.from(await response.arrayBuffer())
}
