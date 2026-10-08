// Re-empaqueta las grabaciones viejas (WebM de MediaRecorder sin duración ni índice)
// para que se reproduzcan al instante. Mismo proceso que src/features/recording/services/remux.ts.
// Corre dentro del contenedor:
//   node /app/scripts/remux-recordings.cjs            → prueba: lista lo que haría
//   node /app/scripts/remux-recordings.cjs --aplicar  → re-empaqueta (guarda el original como recording.orig.webm)
//   node /app/scripts/remux-recordings.cjs --limpiar  → borra los recording.orig.webm ya verificados
const { PrismaClient } = require('@prisma/client')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const prisma = new PrismaClient()
const ROOT = path.resolve(process.env.UPLOAD_DIR || '/uploads')
const apply = process.argv.includes('--aplicar')
const clean = process.argv.includes('--limpiar')

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', file], { timeout: 120000 })
  const data = JSON.parse(String(out))
  const d = Number(data.format && data.format.duration)
  const video = (data.streams || []).find((s) => s.codec_type === 'video')
  return { videoCodec: video ? video.codec_name : null, durationSecs: Number.isFinite(d) && d > 0 ? Math.round(d) : null }
}

function inside(p) {
  const r = path.resolve(p)
  return r.startsWith(ROOT + path.sep)
}

async function main() {
  const recs = await prisma.recording.findMany({
    where: { storagePath: { not: null } },
    select: { id: true, storagePath: true, durationSecs: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  let done = 0, skipped = 0, failed = 0, cleaned = 0
  for (const r of recs) {
    const file = path.join(ROOT, r.storagePath)
    const dir = path.dirname(file)
    const orig = path.join(dir, 'recording.orig.webm')
    if (!inside(file)) { console.log('fuera de UPLOAD_DIR, se omite', r.id); skipped++; continue }

    if (clean) {
      if (fs.existsSync(orig) && r.durationSecs && fs.existsSync(file) && file !== orig) { fs.unlinkSync(orig); cleaned++ }
      continue
    }
    if (r.durationSecs && !r.storagePath.endsWith('.webm')) { skipped++; continue } // ya es MP4 con duración
    if (r.durationSecs && fs.existsSync(orig)) { skipped++; continue } // ya re-empaquetado
    if (!fs.existsSync(file)) { console.log('sin archivo', r.id); skipped++; continue }

    const sizeMb = (fs.statSync(file).size / 1048576).toFixed(0)
    if (!apply) { console.log('re-empaquetaría', r.id, sizeMb + ' MB'); continue }

    const t0 = Date.now()
    try {
      if (!fs.existsSync(orig)) fs.renameSync(file, orig)
      const { videoCodec } = probe(orig)
      const ext = videoCodec === 'h264' ? 'mp4' : 'webm'
      const tmp = path.join(dir, 'recording.tmp.' + ext)
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-fflags', '+genpts', '-i', orig, '-map', '0', '-c', 'copy']
      args.push(...(ext === 'mp4' ? ['-movflags', '+faststart'] : ['-cues_to_front', '1']))
      args.push(tmp)
      execFileSync('ffmpeg', args, { timeout: 30 * 60000 })
      const info = probe(tmp)
      if (!info.durationSecs) throw new Error('sin duración tras re-empaquetar')
      const final = path.join(dir, 'recording.' + ext)
      fs.renameSync(tmp, final)
      const storagePath = path.relative(ROOT, final).split(path.sep).join('/')
      await prisma.recording.update({ where: { id: r.id }, data: { storagePath, durationSecs: info.durationSecs, fileSizeBytes: BigInt(fs.statSync(final).size) } })
      done++
      console.log('ok', r.id, sizeMb + ' MB', info.durationSecs + ' s', ((Date.now() - t0) / 1000).toFixed(1) + ' s')
    } catch (e) {
      failed++
      console.log('FALLÓ', r.id, e.message)
      // Deja el original en su lugar para que siga reproduciéndose como antes.
      if (fs.existsSync(orig) && !fs.existsSync(file)) fs.renameSync(orig, file)
    }
  }
  console.log(clean ? `originales borrados: ${cleaned}` : `${apply ? 'hechas' : 'por hacer'}: ${apply ? done : recs.length - skipped} · omitidas: ${skipped} · fallidas: ${failed}`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('ERROR', e.message); await prisma.$disconnect(); process.exit(1) })
