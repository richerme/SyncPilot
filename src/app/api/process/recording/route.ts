import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { chatCompletion, transcribe } from '@/lib/openrouter'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'

export const maxDuration = 300

// execFile (NO exec): los argumentos van directo a ffmpeg sin pasar por un shell,
// asi un videoPath con metacaracteres se trata como nombre de archivo literal.
// Nunca usar exec()/shell con rutas derivadas de datos del usuario (RCE).
const execFileAsync = promisify(execFile)

const RequestSchema = z.object({
  recording_id: z.string(),
})

const SILENCE_PATTERNS = ['[SILENCIO]', '[SILENCE]', '[NO SPEECH]', '[NO AUDIO]', '[INAUDIBLE]']

async function extractAudioChunks(videoPath: string, tmpDir: string): Promise<string[]> {
  await mkdir(tmpDir, { recursive: true })

  const chunkDuration = 30
  const outputPattern = path.join(tmpDir, 'chunk-%03d.webm')

  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vn', '-acodec', 'libopus', '-ar', '16000', '-ac', '1',
    '-f', 'segment', '-segment_time', String(chunkDuration),
    outputPattern, '-y',
  ])

  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunkPath = path.join(tmpDir, `chunk-${String(i).padStart(3, '0')}.webm`)
    if (!existsSync(chunkPath)) break
    chunks.push(chunkPath)
    i++
  }
  return chunks
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'recording_id requerido' }, { status: 400 })

  const recordingId = parsed.data.recording_id
  const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')

  const recording = await prisma.recording.findFirst({
    where: { id: recordingId, userId: session.user.id },
    select: { id: true, title: true, storagePath: true, status: true },
  })

  if (!recording) return NextResponse.json({ error: 'Grabación no encontrada' }, { status: 404 })
  if (!recording.storagePath) return NextResponse.json({ error: 'El video aún no se ha subido' }, { status: 400 })

  const videoPath = path.join(uploadDir, recording.storagePath)
  const tmpDir = path.join(uploadDir, session.user.id, recordingId, 'tmp')

  // El archivo puede no existir (p. ej. subido antes de montar el volumen
  // persistente). Mejor un error claro que un 500 críptico de ffmpeg.
  if (!existsSync(videoPath)) {
    await prisma.recording.update({ where: { id: recordingId }, data: { status: 'error' } }).catch(() => {})
    return NextResponse.json(
      { error: 'El archivo de video ya no está disponible en el servidor. Vuelve a subir la grabación.' },
      { status: 410 }
    )
  }

  await prisma.recording.update({ where: { id: recordingId }, data: { status: 'processing' } })

  try {
    // 1. Limpiar datos anteriores
    await Promise.all([
      prisma.transcript.deleteMany({ where: { recordingId } }),
      prisma.chapter.deleteMany({ where: { recordingId } }),
      prisma.aiSummary.deleteMany({ where: { recordingId } }),
      prisma.actionItem.deleteMany({ where: { recordingId } }),
    ])

    let fullTranscript = ''

    // 2. Intentar extraer audio con ffmpeg y transcribir por chunks
    let transcriptSegments: Array<{ startMs: number; endMs: number; text: string }> = []

    try {
      const chunks = await extractAudioChunks(videoPath, tmpDir)

      for (let i = 0; i < chunks.length; i++) {
        const chunkPath = chunks[i]
        const buffer = await readFile(chunkPath)
        const base64 = buffer.toString('base64')

        const text = await transcribe(base64, 'audio/webm')
        const issilence = !text || text.length < 2 || SILENCE_PATTERNS.some(p => text.toUpperCase().includes(p))

        if (!issilence) {
          const startMs = i * 30 * 1000
          const endMs = (i + 1) * 30 * 1000
          transcriptSegments.push({ startMs, endMs, text })
          fullTranscript += text + ' '
        }

        await unlink(chunkPath).catch(() => {})
      }
    } catch (ffmpegErr) {
      console.warn('[process/recording] ffmpeg not available, using fallback:', ffmpegErr)
      // Fallback: leer el archivo completo como audio (puede fallar con archivos grandes)
      const buffer = await readFile(videoPath)
      const base64 = buffer.toString('base64')
      const text = await transcribe(base64, 'video/webm')
      if (text && text.length > 2) {
        transcriptSegments = [{ startMs: 0, endMs: 60000, text }]
        fullTranscript = text
      }
    }

    // 3. Guardar transcripción en BD
    if (transcriptSegments.length > 0) {
      await prisma.transcript.createMany({
        data: transcriptSegments.map(s => ({
          recordingId, startMs: s.startMs, endMs: s.endMs,
          text: s.text, language: 'es', confidence: 0.9,
        })),
      })
    }

    // 4. Analizar con IA (capítulos, resumen, action items)
    if (fullTranscript.trim().length > 10) {
      const analysisPrompt = `Analiza la siguiente transcripción de una reunión o grabación de pantalla y devuelve un JSON con este formato exacto:
{
  "language": "es",
  "sentiment": "positive|neutral|negative",
  "chapters": [{ "title": "...", "start_ms": 0, "end_ms": 60000, "summary": "..." }],
  "summary": "Resumen ejecutivo en 3-5 oraciones",
  "key_points": ["Punto 1", "Punto 2"],
  "action_items": [{ "text": "Tarea", "assignee": null, "due_date_text": null }]
}

TRANSCRIPCIÓN:
${fullTranscript.slice(0, 6000)}`

      let analysis: {
        language: string
        sentiment: string
        chapters: Array<{ title: string; start_ms: number; end_ms: number; summary: string }>
        summary: string
        key_points: string[]
        action_items: Array<{ text: string; assignee: string | null; due_date_text: string | null }>
      }

      try {
        const raw = await chatCompletion(
          [{ role: 'user', content: analysisPrompt }],
          { temperature: 0.3, maxTokens: 2048, jsonMode: true }
        )
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        analysis = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
      } catch {
        analysis = {
          language: 'es', sentiment: 'neutral',
          chapters: [], summary: 'No se pudo generar el análisis.', key_points: [], action_items: [],
        }
      }

      const totalMs = transcriptSegments.length > 0
        ? transcriptSegments[transcriptSegments.length - 1].endMs
        : 60000

      if (analysis.chapters?.length > 0) {
        await prisma.chapter.createMany({
          data: analysis.chapters.map((ch, i) => ({
            recordingId, title: ch.title, startMs: ch.start_ms ?? 0,
            endMs: ch.end_ms ?? totalMs, summary: ch.summary, orderIndex: i,
          })),
        })
      }

      await prisma.aiSummary.create({
        data: {
          recordingId,
          summaryText: analysis.summary ?? '',
          keyPoints: analysis.key_points ?? [],
          sentiment: (['positive', 'neutral', 'negative'].includes(analysis.sentiment)
            ? analysis.sentiment : 'neutral') as 'positive' | 'neutral' | 'negative',
        },
      })

      if (analysis.action_items?.length > 0) {
        await prisma.actionItem.createMany({
          data: analysis.action_items.map(item => ({
            recordingId, text: item.text,
            assignee: item.assignee ?? null, dueDateText: item.due_date_text ?? null,
          })),
        })
      }
    }

    await prisma.recording.update({ where: { id: recordingId }, data: { status: 'ready' } })

    return NextResponse.json({
      success: true,
      stats: { transcript_segments: transcriptSegments.length, language: 'es' },
    })

  } catch (err) {
    console.error('[process/recording]', err)
    await prisma.recording.update({ where: { id: recordingId }, data: { status: 'error' } }).catch(() => {})
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error al procesar el video' },
      { status: 500 }
    )
  }
}
