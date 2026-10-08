// Rutas de los archivos de una grabación (solo servidor).
// Durante la grabación los pedazos se juntan en RAW_FILE; al terminar se re-empaqueta
// (sin re-codificar) a recording.mp4 (H.264) o recording.webm (VP8/VP9) con duración e índice.
import path from 'node:path'

export const RAW_FILE = 'recording.raw.webm'

export const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'))

export function recordingDir(userId: string, recordingId: string): string {
  const dir = path.resolve(uploadRoot(), userId, recordingId)
  // userId y recordingId vienen de la sesión y de la BD (cuid), pero se contiene igual.
  if (!dir.startsWith(uploadRoot() + path.sep)) throw new Error('Ruta de grabación inválida')
  return dir
}

/** Ruta relativa a UPLOAD_DIR con "/" (lo que se guarda en Recording.storagePath). */
export const storagePathFor = (userId: string, recordingId: string, file: string) => [userId, recordingId, file].join('/')
