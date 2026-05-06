'use strict'
// Aplica migraciones usando Prisma Client (no requiere CLI ni el módulo 'effect')
const { PrismaClient } = require('@prisma/client')
const fs   = require('fs')
const path = require('path')

const prisma = new PrismaClient({ log: ['error'] })

async function run() {
  try {
    // Verificar si las tablas ya existen (más confiable que tracking de migraciones)
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS cnt
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'User'
    `
    const exists = Number(rows[0]?.cnt ?? 0) > 0

    if (exists) {
      console.log('[migrate] Tablas ya existen, sin cambios.')
      return
    }

    console.log('[migrate] Aplicando migración inicial...')

    const migDir = path.join(__dirname, '..', 'prisma', 'migrations')
    if (!fs.existsSync(migDir)) { console.log('[migrate] Sin directorio de migraciones'); return }

    const dirs = fs.readdirSync(migDir)
      .filter(d => { try { return fs.statSync(path.join(migDir, d)).isDirectory() } catch { return false } })
      .sort()

    for (const dir of dirs) {
      const sqlPath = path.join(migDir, dir, 'migration.sql')
      if (!fs.existsSync(sqlPath)) continue

      console.log(`[migrate] apply: ${dir}`)
      const sql = fs.readFileSync(sqlPath, 'utf-8')

      // Dividir por ; y quitar SOLO las líneas de comentario (no el statement completo)
      const stmts = sql
        .split(';')
        .map(chunk =>
          chunk
            .split('\n')
            .filter(line => !line.trimStart().startsWith('--'))
            .join('\n')
            .trim()
        )
        .filter(s => s.length > 5)  // ignorar fragmentos vacíos

      console.log(`[migrate] ${stmts.length} statements a ejecutar`)

      for (const stmt of stmts) {
        await prisma.$executeRawUnsafe(stmt)
      }

      console.log(`[migrate] done: ${dir}`)
    }

    console.log('[migrate] Completado.')
  } catch (err) {
    console.error('[migrate] ERROR:', err.message)
    process.exit(1)   // forzar restart para que no quede en estado inconsistente
  } finally {
    await prisma.$disconnect()
  }
}

run()
