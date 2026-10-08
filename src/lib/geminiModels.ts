// Modelos de Gemini para IA en Vivo (medidos el 2026-10-08, mediana de 5 llamadas):
// - transcribir un tramo de 3.5 s: gemini-3.5-flash 0.8 s (gemini-2.5-flash: 1.4 s)
// - traducir una frase: gemini-3.5-flash-lite 0.6 s
// - Copiloto, primera palabra en streaming: gemini-3.5-flash 0.8 s
// gemini-2.5-flash-lite ya no se ofrece a cuentas nuevas (404).
export const GEMINI_MODELS = {
  transcribe: 'gemini-3.5-flash',
  copilot:    'gemini-3.5-flash',
  translate:  'gemini-3.5-flash-lite',
} as const

// En los modelos 3.x el razonamiento viene encendido y se come maxOutputTokens: con
// 256 tokens la transcripción salía VACÍA. Para transcribir y contestar en vivo no
// hace falta. (En los Flash-Lite no se manda: rechazan thinkingBudget 0 con 400.)
export const NO_THINKING = { thinkingBudget: 0 }
