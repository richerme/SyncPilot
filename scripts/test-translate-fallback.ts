// Traducción de respaldo (decisión 1a del 25 nov), lógica pura sin red ni audio:
//   npx tsx scripts/test-translate-fallback.ts
// Caso real de la reunión del 25 nov: Soniox marcó «es» el último token de una frase en inglés, no la tradujo y la
// columna de traducción mostraba el original. Ahora decide la mayoría de los tokens (más un desempate por palabras
// comunes) y, si es otro idioma sin traducción, pide el respaldo.
import { StreamTurns, phraseLanguage, type SonioxToken } from '../src/features/live/engines/streamEngine'
import type { EngineCallbacks } from '../src/features/live/engines/types'

let failures = 0
const check = (ok: boolean, label: string) => { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failures++ }

// 1) Idioma de la frase
check(phraseLanguage({ en: 6, es: 1 }, 'can you check the BAdI') === 'en', 'mayoría de tokens en inglés → en')
check(phraseLanguage({ en: 1, es: 1 }, 'we need to check the delivery and the IDoc') === 'en', 'empate de tokens, palabras inglesas → en')
check(phraseLanguage({ es: 5 }, 'so we need to move the transport to QAS') === 'en', 'todo marcado es, pero el texto es inglés → en')
check(phraseLanguage({ es: 5 }, 'entonces revisamos el pedido y la entrega') === 'es', 'español de verdad → es')
check(phraseLanguage({ en: 2 }, 'BAdI ZSD') === 'en', 'pocas palabras: decide la mayoría de tokens')

// 2) StreamTurns con traducción a español
function setup() {
  const log: string[] = []
  const diags: string[] = []
  const cb: EngineCallbacks = {
    preview: () => {}, translationPreview: () => {}, turnEnd: () => {}, heard: () => {}, log: () => {},
    commit: (t, tr) => log.push(`C[${t}=>${tr ?? ''}]`),
    amendTranslation: t => log.push(`A[${t}]`),
    translateFallback: t => log.push(`F[${t}]`),
    diag: e => diags.push(e),
  }
  return { turns: new StreamTurns(cb, 'es'), log, diags }
}
const tok = (text: string, language: string): SonioxToken => ({ text, is_final: true, language })
const end: SonioxToken = { text: '<end>', is_final: true }

{
  const { turns, log, diags } = setup()
  // Inglés con el último token marcado «es» y sin traducción de Soniox
  turns.handle({ tokens: [tok('So', 'en'), tok(' we need', 'en'), tok(' to check', 'en'), tok(' the delivery', 'en'), tok(' today', 'es'), end] })
  check(log.includes('C[So we need to check the delivery today=>]'), 'frase inglesa con el último token «es»: no se muestra el original como traducción')
  check(log.includes('F[So we need to check the delivery today]'), '…y pide la traducción de respaldo')
  check(turns.fallbacks === 1 && diags.includes('translate-fallback'), 'cuenta el respaldo y manda el diagnóstico')
}
{
  const { turns, log } = setup()
  turns.handle({ tokens: [tok('Entonces', 'es'), tok(' revisamos', 'es'), tok(' el pedido', 'es'), end] })
  check(log.includes('C[Entonces revisamos el pedido=>Entonces revisamos el pedido]'), 'español real: se muestra tal cual')
  check(!log.some(l => l.startsWith('F[')), '…sin respaldo')
}
{
  const { turns, log } = setup()
  const tr = (text: string): SonioxToken => ({ text, is_final: true, translation_status: 'translation' })
  turns.handle({ tokens: [tok('Can you', 'en'), tok(' check it?', 'en'), tr('¿Puedes revisarlo?'), end] })
  check(log.includes('C[Can you check it?=>¿Puedes revisarlo?]') && !log.some(l => l.startsWith('F[')), 'con traducción de Soniox no hay respaldo')
}
{
  const { turns, log } = setup()
  // Mezcla: la mayoría en inglés con términos que Soniox marcó español
  turns.handle({ tokens: [tok('The', 'en'), tok(' pedido', 'es'), tok(' is', 'en'), tok(' blocked', 'en'), tok(' for', 'en'), tok(' billing', 'en'), end] })
  check(log.some(l => l.startsWith('F[The pedido is blocked for billing')), 'mezcla con mayoría inglesa → respaldo')
}
{
  const log: string[] = []
  const turns = new StreamTurns({ preview: () => {}, turnEnd: () => {}, heard: () => {}, log: () => {}, commit: (t, tr) => log.push(`C[${t}=>${tr ?? ''}]`), translateFallback: t => log.push(`F[${t}]`) }, null)
  turns.handle({ tokens: [tok('Hello', 'en'), tok(' team', 'en'), end] })
  check(!log.some(l => l.startsWith('F[')), 'sin traducción activa no se pide respaldo')
}

console.log(failures ? `\n${failures} fallaron` : '\nTodo pasó')
process.exit(failures ? 1 : 0)
