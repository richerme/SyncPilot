'use strict'
// Aplica migraciones usando Prisma Client (no requiere CLI ni el módulo 'effect')
const { PrismaClient } = require('@prisma/client')
const fs   = require('fs')
const path = require('path')

const prisma = new PrismaClient({ log: ['error'] })

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

async function run() {
  try {
    // Tabla de tracking de migraciones (igual al schema de Prisma)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id"                  VARCHAR(36)  NOT NULL,
        "checksum"            VARCHAR(64)  NOT NULL DEFAULT '',
        "finished_at"         TIMESTAMPTZ,
        "migration_name"      VARCHAR(255) NOT NULL,
        "logs"                TEXT,
        "rolled_back_at"      TIMESTAMPTZ,
        "started_at"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "applied_steps_count" INTEGER      NOT NULL DEFAULT 0,
        PRIMARY KEY ("id"),
        UNIQUE ("migration_name")
      )
    `)

    const migDir = path.join(__dirname, '..', 'prisma', 'migrations')
    if (!fs.existsSync(migDir)) { console.log('[migrate] Sin migraciones'); return }

    const dirs = fs.readdirSync(migDir)
      .filter(d => {
        try { return fs.statSync(path.join(migDir, d)).isDirectory() } catch { return false }
      })
      .sort()

    for (const dir of dirs) {
      const sqlPath = path.join(migDir, dir, 'migration.sql')
      if (!fs.existsSync(sqlPath)) continue

      const already = await prisma.$queryRaw`
        SELECT id FROM "_prisma_migrations"
        WHERE migration_name = ${dir} AND finished_at IS NOT NULL
      `
      if (already.length > 0) { console.log(`[migrate] skip: ${dir}`); continue }

      console.log(`[migrate] apply: ${dir}`)
      const sql = fs.readFileSync(sqlPath, 'utf-8')

      // Ejecutar cada statement por separado
      const stmts = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 3 && !s.startsWith('--'))

      for (const stmt of stmts) {
        await prisma.$executeRawUnsafe(stmt)
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
         VALUES ($1, '', NOW(), $2, 1)
         ON CONFLICT (migration_name) DO UPDATE SET finished_at = NOW()`,
        uuid(), dir
      )
      console.log(`[migrate] done: ${dir}`)
    }
    console.log('[migrate] Completado.')
  } catch (err) {
    console.error('[migrate] ERROR:', err.message)
  } finally {
    await prisma.$disconnect()
  }
}

run()
