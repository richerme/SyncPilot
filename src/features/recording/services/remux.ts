// Re-empaqueta (sin re-codificar: `-c copy`, segundos aunque pese cientos de MB) el
// video que arma MediaRecorder. Ese WebM no trae duración ni índice de búsqueda, así
// que el reproductor tenía que recorrer el archivo completo antes de empezar.
// H.264 → MP4 con el índice al inicio (faststart); VP8/VP9 → WebM con Cues.
// Solo servidor. Mismo proceso en scripts/remux-recordings.cjs (para las grabaciones viejas).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

const run = promisify(execFile)

interface ProbeInfo { videoCodec: string | null; durationSecs: number | null }

export async function probe(file: string): Promise<ProbeInfo> {
  // execFile: los argumentos van directo a ffprobe, sin shell.
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', file], { timeout: 60_000 })
  const data = JSON.parse(stdout) as { streams?: { codec_type?: string; codec_name?: string }[]; format?: { duration?: string } }
  const duration = Number(data.format?.duration)
  return {
    videoCodec: data.streams?.find(s => s.codec_type === 'video')?.codec_name ?? null,
    durationSecs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
  }
}

/** Convierte `input` en recording.mp4|webm dentro de `dir`. Borra `input` solo si todo salió bien. */
export async function remuxRecording(dir: string, input: string): Promise<{ file: string; size: number; durationSecs: number | null }> {
  const { videoCodec } = await probe(input)
  const ext = videoCodec === 'h264' ? 'mp4' : 'webm'
  const file = `recording.${ext}`
  const tmp = path.join(dir, `recording.tmp.${ext}`)
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-fflags', '+genpts', '-i', input, '-map', '0', '-c', 'copy']
  // El índice al inicio del archivo: el navegador no tiene que ir a buscarlo al final.
  args.push(...(ext === 'mp4' ? ['-movflags', '+faststart'] : ['-cues_to_front', '1']))
  args.push(tmp)
  try {
    await run('ffmpeg', args, { timeout: 15 * 60_000, maxBuffer: 10 * 1024 * 1024 })
    const out = await probe(tmp)
    if (!out.durationSecs) throw new Error('El archivo re-empaquetado no tiene duración')
    const final = path.join(dir, file)
    await rename(tmp, final)
    if (path.resolve(input) !== path.resolve(final)) await unlink(input).catch(() => {})
    return { file, size: (await stat(final)).size, durationSecs: out.durationSecs }
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}
