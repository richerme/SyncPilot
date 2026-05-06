export type SupportedLanguage = 'es' | 'en' | 'fr' | 'pt' | 'de' | 'ja' | 'zh' | 'it' | 'ko'

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  es: '🇪🇸 Español',
  en: '🇬🇧 English',
  fr: '🇫🇷 Français',
  pt: '🇧🇷 Português',
  de: '🇩🇪 Deutsch',
  ja: '🇯🇵 日本語',
  zh: '🇨🇳 中文',
  it: '🇮🇹 Italiano',
  ko: '🇰🇷 한국어',
}

export interface TranslationResult {
  originalText:   string
  translatedText: string
  detectedLang:   string
  targetLang:     SupportedLanguage
  audioBase64?:   string   // MP3 base64 del TTS
}

export interface AccentAnalysis {
  detectedLanguage:  string
  languageCode:      string
  accentProbable:    string
  estimatedRegion:   string
  clarityScore:      number       // 0-100
  suggestions:       string[]
  confidence:        number       // 0-100
}

export interface MeetingAnalysis {
  executiveSummary:  string
  decisions:         string[]
  nextSteps:         string[]
  participants:      string[]
  tensionPoints:     string[]
  sentiment:         'positive' | 'neutral' | 'negative'
  sentimentScore:    number       // 0-100
  keyTopics:         string[]
  duration:          string
}

export type AudioToolTab = 'translator' | 'detector' | 'meeting' | 'noise' | 'live'
