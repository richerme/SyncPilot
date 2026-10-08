// Pruebas de la lógica pura de IA en Vivo y documentos (sin red ni BD):
//   npx tsx scripts/test-live-logic.ts <audio.wav>  (WAV 16 kHz mono: silencio, frase, silencio, pregunta, silencio)
import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import path from 'node:path'
import { SpeechSegmenter, OrderedDelivery, encodeWav } from '../src/features/live/audio/meetingAudio'
import { extractDocxText } from '../src/lib/docx'
import { NAME_PATTERN } from '../src/features/live/copilot/profile'

let failures = 0
const check = (ok: boolean, label: string) => { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failures++ }

// 1) Segmentador con el audio real de prueba (0.6 s silencio · frase 1 · 1.5 s silencio · pregunta · 2 s silencio)
const wav = readFileSync(process.argv[2] ?? path.join(process.cwd(), 'meeting.wav'))
const pcm16 = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2)
const pcm = Float32Array.from(pcm16, v => v / 32768)
const events: string[] = []
const chunks: number[] = []
const seg = new SpeechSegmenter(p => { chunks.push(p.length / 16000); events.push(`chunk ${(p.length / 16000).toFixed(1)}s`) }, () => events.push('turnEnd'))
for (let i = 0; i + 1600 <= pcm.length; i += 1600) seg.push(pcm.slice(i, i + 1600))
seg.flush()
console.log('  eventos:', events.join(' | '))
check(chunks.length >= 2, `corta en pausas (${chunks.length} tramos)`)
check(chunks.every(s => s <= 5.1), 'ningún tramo pasa de 5 s')
check(events.filter(e => e === 'turnEnd').length === 2, 'detecta 2 fines de turno (tras cada frase)')
const firstTurnEnd = events.indexOf('turnEnd')
check(firstTurnEnd > 0 && events.slice(0, firstTurnEnd).every(e => e.startsWith('chunk')), 'el primer fin de turno llega después de los tramos de la frase 1')
const silent = new SpeechSegmenter(() => events.push('NO'), () => events.push('NO'))
for (let i = 0; i < 50; i++) silent.push(new Float32Array(1600))
silent.flush()
check(!events.includes('NO'), 'el silencio puro no se manda ni marca fin de turno')

// 2) Entrega en orden
const got: number[] = []
const d = new OrderedDelivery<number>(v => got.push(v))
const [a, b, c] = [d.ticket(), d.ticket(), d.ticket()]
d.resolve(c, 3); d.resolve(a, 1); check(got.join() === '1', 'retiene el 3 hasta que llegue el 2')
d.resolve(b, 2); check(got.join() === '1,2,3', 'entrega 1,2,3 en orden')

// 3) WAV
const blob = encodeWav(new Float32Array(16000))
check(blob.size === 44 + 32000, `WAV de 1 s = 32,044 bytes (${blob.size})`)

// 4) Nombre
check(NAME_PATTERN.test('Rick, can you tell us') && NAME_PATTERN.test('what do you think, Ric?') && NAME_PATTERN.test('Ricardo, ¿cuánto tarda?'), 'detecta Rick / Ric / Ricardo')
check(!NAME_PATTERN.test('the price is tricky') && !NAME_PATTERN.test('Erick will join') && !NAME_PATTERN.test('a rich client'), 'no confunde tricky / Erick / rich')

// 5) .docx mínimo armado aquí (ZIP con word/document.xml comprimido)
function zip(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content)
  const nameBuf = Buffer.from(name)
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBuf.length, 26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42)
  const cdOffset = 30 + nameBuf.length + data.length
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + nameBuf.length, 12); eocd.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd])
}
const xml = '<w:document><w:body><w:p><w:r><w:t>Especificación funcional</w:t></w:r></w:p><w:p><w:r><w:t>BAdI ME_PROCESS_PO_CUST &amp; tabla ZMM_LOG</w:t></w:r></w:p></w:body></w:document>'
const text = extractDocxText(zip('word/document.xml', Buffer.from(xml)))
check(text === 'Especificación funcional\n\nBAdI ME_PROCESS_PO_CUST & tabla ZMM_LOG', `extrae el texto del .docx (${JSON.stringify(text)})`)
check(extractDocxText(Buffer.from('no es un zip')) === '', 'un archivo dañado no truena')

console.log(failures ? `\n${failures} fallaron` : '\nTodo pasó')
process.exit(failures ? 1 : 0)
