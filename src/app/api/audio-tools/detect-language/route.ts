import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { transcribeAudio, chatCompletion } from '@/lib/openrouter'
import { z } from 'zod'

const Schema = z.object({
  audio_base64: z.string().min(10),
  mime_type:    z.string().default('audio/webm'),
})

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const { audio_base64, mime_type } = parsed.data

  const transcribedText = await transcribeAudio(audio_base64, mime_type)
  if (!transcribedText || transcribedText.length < 3) {
    return NextResponse.json({ error: 'No se detectó habla suficiente. Graba al menos 5 segundos hablando.' }, { status: 422 })
  }

  const analysisPrompt = `Analyze the following transcribed speech and provide a detailed accent and language analysis.
Return ONLY a valid JSON object with this exact structure:
{
  "detectedLanguage": "nombre completo del idioma detectado",
  "languageCode": "código ISO 639-1 de 2 letras",
  "accentProbable": "tipo de acento más probable (ej: 'Español Mexicano', 'English British', 'Mandarin-influenced English')",
  "estimatedRegion": "región geográfica probable (ej: 'América Latina - México', 'East Asia - China', 'South Asia - India')",
  "clarityScore": número entre 0 y 100 que indica claridad de comunicación,
  "suggestions": ["sugerencia 1 de mejora", "sugerencia 2", "sugerencia 3"],
  "confidence": número entre 0 y 100 de confianza en el análisis
}

Transcribed speech: "${transcribedText.slice(0, 1000)}"`

  try {
    const raw = await chatCompletion([{ role: 'user', content: analysisPrompt }], {
      temperature: 0.3, maxTokens: 512, jsonMode: true,
    })
    const match = raw.match(/\{[\s\S]*\}/)
    const analysis = JSON.parse(match ? match[0] : raw)
    return NextResponse.json(analysis)
  } catch {
    return NextResponse.json({
      detectedLanguage:  'No detectado',
      languageCode:      '??',
      accentProbable:    'Indeterminado',
      estimatedRegion:   'Desconocida',
      clarityScore:      50,
      suggestions:       ['Habla más lento', 'Pronuncia las vocales claramente', 'Reduce el ruido de fondo'],
      confidence:        40,
    })
  }
}
