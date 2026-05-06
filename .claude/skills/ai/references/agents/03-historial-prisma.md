# Bloque 03: Historial con Prisma (Action Stream Pattern)

> Guardar y cargar conversaciones con Prisma/PostgreSQL usando el patron Action Stream.

**Tiempo:** 25 minutos
**Prerequisitos:** Bloque 01 (Chat Streaming), PostgreSQL configurado

---

## Que Obtienes

- Conversaciones persistentes con acciones tipadas
- Sidebar responsivo con lista de sesiones
- Crear/cargar/eliminar sesiones
- Soporte para multiples tipos de acciones (no solo texto)
- Batch save para mejor performance
- Auto-generacion de titulos
- Soporte para diferentes modelos

---

## 1. Schema de Base de Datos (Prisma)

Agregar estos modelos a `prisma/schema.prisma`:

```prisma
enum ActionType {
  user_message
  think
  message
  analyze
  calculate
  recommend
  alert
}

model AgentSession {
  id        String        @id @default(cuid())
  userId    String
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String        @default("Nueva sesion")
  model     String        @default("haiku-4.5")
  actions   AgentAction[]
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  @@index([userId])
  @@index([updatedAt(sort: Desc)])
}

model AgentAction {
  id         String      @id @default(cuid())
  sessionId  String
  session    AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  actionType ActionType
  content    Json
  createdAt  DateTime    @default(now())

  @@index([sessionId])
  @@index([createdAt(sort: Asc)])
}
```

Agregar la relacion en el modelo User:
```prisma
model User {
  // ... campos existentes ...
  agentSessions AgentSession[]
}
```

Ejecutar migracion:
```bash
npx prisma migrate dev --name add_agent_history
```

---

## 2. Tipos TypeScript

```typescript
// features/agent/types/index.ts

export interface AgentSession {
  id: string
  user_id: string
  title: string
  model: string
  created_at: string
  updated_at: string
}

export type ActionType =
  | 'user_message'
  | 'think'
  | 'message'
  | 'analyze'
  | 'calculate'
  | 'recommend'
  | 'alert'

export interface AgentActionRecord {
  id: string
  session_id: string
  action_type: ActionType
  content: Record<string, unknown>
  created_at: string
}

// Tipos para UI (las acciones en memoria)
export interface BaseAction {
  _type: ActionType
  complete: boolean
}

export interface UserMessageAction extends BaseAction {
  _type: 'user_message'
  text: string
}

export interface ThinkAction extends BaseAction {
  _type: 'think'
  text: string
}

export interface MessageAction extends BaseAction {
  _type: 'message'
  text: string
}

export interface AnalyzeAction extends BaseAction {
  _type: 'analyze'
  title: string
  points: string[]
}

export interface CalculateAction extends BaseAction {
  _type: 'calculate'
  label: string
  value: string | number
  trend?: 'up' | 'down' | 'neutral'
}

export interface RecommendAction extends BaseAction {
  _type: 'recommend'
  title: string
  items: string[]
}

export interface AlertAction extends BaseAction {
  _type: 'alert'
  severity: 'info' | 'warning' | 'critical'
  message: string
}

export type AgentAction =
  | UserMessageAction
  | ThinkAction
  | MessageAction
  | AnalyzeAction
  | CalculateAction
  | RecommendAction
  | AlertAction
```

---

## 3. Servicio de Historial (Prisma)

```typescript
// features/agent/services/historyService.ts

import { prisma } from '@/lib/db'
import type { AgentSession, AgentAction as AgentActionRecord } from '@prisma/client'
import type { ActionType } from '../types'

export const agentHistoryService = {
  async listSessions(userId: string, limit = 20) {
    return prisma.agentSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
  },

  async createSession(userId: string, title?: string, model?: string) {
    return prisma.agentSession.create({
      data: {
        userId,
        title: title || 'Nueva sesion',
        model: model || 'haiku-4.5',
      },
    })
  },

  async loadActions(sessionId: string) {
    return prisma.agentAction.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    })
  },

  async saveAction(sessionId: string, actionType: ActionType, content: Record<string, unknown>) {
    const action = await prisma.agentAction.create({
      data: { sessionId, actionType, content },
    })

    await prisma.agentSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    })

    return action
  },

  async saveActions(sessionId: string, actions: Array<{ actionType: ActionType; content: Record<string, unknown> }>) {
    const result = await prisma.$transaction(async (tx) => {
      const created = await Promise.all(
        actions.map(a => tx.agentAction.create({
          data: { sessionId, actionType: a.actionType, content: a.content },
        }))
      )

      await tx.agentSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      })

      return created
    })

    return result
  },

  async updateSessionTitle(sessionId: string, title: string) {
    await prisma.agentSession.update({
      where: { id: sessionId },
      data: { title: title.slice(0, 100) },
    })
  },

  async deleteSession(sessionId: string) {
    await prisma.agentSession.delete({ where: { id: sessionId } })
  },

  async getSession(sessionId: string) {
    return prisma.agentSession.findUnique({ where: { id: sessionId } })
  },
}
```

---

## 4. Hook useAgentHistory (Mejorado)

```typescript
// features/agent/hooks/useAgentHistory.ts

'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  agentHistoryService,
  type AgentSession,
  type AgentActionRecord,
  type ActionType,
} from '../services/historyService'

interface UseAgentHistoryOptions {
  autoLoad?: boolean
}

export function useAgentHistory(options: UseAgentHistoryOptions = {}) {
  const { autoLoad = true } = options

  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentActions, setCurrentActions] = useState<AgentActionRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cargar lista de sesiones al montar
  useEffect(() => {
    if (autoLoad) {
      loadSessions()
    }
  }, [autoLoad])

  /**
   * Carga la lista de sesiones
   */
  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await agentHistoryService.listSessions()
      setSessions(data)
    } catch (err) {
      console.error('Error loading sessions:', err)
      setError('Error al cargar sesiones')
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Crea una nueva sesion
   */
  const createSession = useCallback(async (title?: string, model?: string) => {
    try {
      setIsSaving(true)
      setError(null)
      const session = await agentHistoryService.createSession(title, model)
      setSessions(prev => [session, ...prev])
      setCurrentSessionId(session.id)
      setCurrentActions([])
      return session
    } catch (err) {
      console.error('Error creating session:', err)
      setError('Error al crear sesion')
      throw err
    } finally {
      setIsSaving(false)
    }
  }, [])

  /**
   * Selecciona una sesion y carga sus acciones
   */
  const selectSession = useCallback(async (sessionId: string) => {
    try {
      setIsLoading(true)
      setError(null)
      setCurrentSessionId(sessionId)
      const actions = await agentHistoryService.loadActions(sessionId)
      setCurrentActions(actions)
      return actions
    } catch (err) {
      console.error('Error loading session:', err)
      setError('Error al cargar sesion')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Guarda una accion en la sesion actual
   */
  const saveAction = useCallback(async (
    actionType: ActionType,
    content: Record<string, unknown>
  ) => {
    if (!currentSessionId) {
      // Crear sesion si no existe
      const session = await createSession()
      const action = await agentHistoryService.saveAction(
        session.id,
        actionType,
        content
      )
      setCurrentActions(prev => [...prev, action])
      return action
    }

    try {
      setIsSaving(true)
      const action = await agentHistoryService.saveAction(
        currentSessionId,
        actionType,
        content
      )
      setCurrentActions(prev => [...prev, action])

      // Actualizar la sesion en la lista (mover al inicio)
      setSessions(prev => {
        const session = prev.find(s => s.id === currentSessionId)
        if (!session) return prev
        const updated = { ...session, updated_at: new Date().toISOString() }
        return [updated, ...prev.filter(s => s.id !== currentSessionId)]
      })

      return action
    } catch (err) {
      console.error('Error saving action:', err)
      setError('Error al guardar accion')
      throw err
    } finally {
      setIsSaving(false)
    }
  }, [currentSessionId, createSession])

  /**
   * Guarda multiples acciones (batch) - util al final de una respuesta
   */
  const saveActions = useCallback(async (
    actions: Array<{
      actionType: ActionType
      content: Record<string, unknown>
    }>
  ) => {
    if (!currentSessionId) {
      const session = await createSession()
      const saved = await agentHistoryService.saveActions(session.id, actions)
      setCurrentActions(prev => [...prev, ...saved])
      return saved
    }

    try {
      setIsSaving(true)
      const saved = await agentHistoryService.saveActions(currentSessionId, actions)
      setCurrentActions(prev => [...prev, ...saved])

      // Actualizar la sesion en la lista
      setSessions(prev => {
        const session = prev.find(s => s.id === currentSessionId)
        if (!session) return prev
        const updated = { ...session, updated_at: new Date().toISOString() }
        return [updated, ...prev.filter(s => s.id !== currentSessionId)]
      })

      return saved
    } catch (err) {
      console.error('Error saving actions:', err)
      setError('Error al guardar acciones')
      throw err
    } finally {
      setIsSaving(false)
    }
  }, [currentSessionId, createSession])

  /**
   * Actualiza el titulo de la sesion actual
   */
  const updateTitle = useCallback(async (title: string) => {
    if (!currentSessionId) return

    try {
      await agentHistoryService.updateSessionTitle(currentSessionId, title)
      setSessions(prev =>
        prev.map(s =>
          s.id === currentSessionId ? { ...s, title } : s
        )
      )
    } catch (err) {
      console.error('Error updating title:', err)
      setError('Error al actualizar titulo')
    }
  }, [currentSessionId])

  /**
   * Elimina una sesion
   */
  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await agentHistoryService.deleteSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))

      // Si es la sesion actual, limpiar
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null)
        setCurrentActions([])
      }
    } catch (err) {
      console.error('Error deleting session:', err)
      setError('Error al eliminar sesion')
      throw err
    }
  }, [currentSessionId])

  /**
   * Inicia una nueva conversacion (limpia estado actual)
   */
  const startNewConversation = useCallback(() => {
    setCurrentSessionId(null)
    setCurrentActions([])
  }, [])

  /**
   * Obtiene la sesion actual
   */
  const currentSession = sessions.find(s => s.id === currentSessionId) || null

  return {
    // Estado
    sessions,
    currentSession,
    currentSessionId,
    currentActions,
    isLoading,
    isSaving,
    error,

    // Acciones
    loadSessions,
    createSession,
    selectSession,
    saveAction,
    saveActions,
    updateTitle,
    deleteSession,
    startNewConversation,
  }
}
```

---

## 5. Componente AgentSidebar (Mejorado)

```typescript
// features/agent/components/AgentSidebar.tsx

'use client'

import { useState } from 'react'
import {
  Plus,
  MessageSquare,
  Trash2,
  X,
  Menu,
  Clock,
} from 'lucide-react'
import type { AgentSession } from '../types'

interface AgentSidebarProps {
  sessions: AgentSession[]
  currentSessionId: string | null
  isLoading: boolean
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onDeleteSession: (sessionId: string) => void
}

export function AgentSidebar({
  sessions,
  currentSessionId,
  isLoading,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}: AgentSidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Ahora'
    if (diffMins < 60) return `${diffMins}m`
    if (diffHours < 24) return `${diffHours}h`
    if (diffDays < 7) return `${diffDays}d`
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
  }

  const handleDelete = (sessionId: string) => {
    if (deleteConfirm === sessionId) {
      onDeleteSession(sessionId)
      setDeleteConfirm(null)
    } else {
      setDeleteConfirm(sessionId)
      // Auto-reset after 3 seconds
      setTimeout(() => setDeleteConfirm(null), 3000)
    }
  }

  return (
    <>
      {/* Mobile Toggle Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="lg:hidden fixed top-20 left-4 z-40 w-10 h-10 bg-white shadow-md rounded-xl flex items-center justify-center text-gray-600 hover:text-blue-600 transition-colors"
        aria-label="Abrir historial"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 h-screen z-50 lg:z-auto
          w-72 bg-gray-50 border-r border-gray-200
          flex flex-col
          transition-transform duration-300
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800">Historial</h2>
            <button
              onClick={() => setIsOpen(false)}
              className="lg:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* New Session Button */}
          <button
            onClick={() => {
              onNewSession()
              setIsOpen(false)
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 text-white rounded-xl font-medium text-sm hover:bg-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nueva conversacion
          </button>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Sin conversaciones</p>
              <p className="text-xs text-gray-400 mt-1">
                Inicia una nueva para comenzar
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => {
                const isSelected = currentSessionId === session.id
                const isDeleting = deleteConfirm === session.id

                return (
                  <div
                    key={session.id}
                    className={`
                      group relative rounded-xl transition-all cursor-pointer p-3
                      ${isSelected
                        ? 'bg-blue-50 border border-blue-200'
                        : 'bg-white border border-gray-100 hover:border-gray-200'
                      }
                    `}
                    onClick={() => {
                      onSelectSession(session.id)
                      setIsOpen(false)
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            isSelected ? 'text-blue-700' : 'text-gray-700'
                          }`}
                        >
                          {session.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span className="text-xs text-gray-400">
                            {formatDate(session.updated_at)}
                          </span>
                          <span className="text-xs text-gray-300">|</span>
                          <span className="text-xs text-gray-400">
                            {session.model}
                          </span>
                        </div>
                      </div>

                      {/* Delete Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(session.id)
                        }}
                        className={`
                          flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
                          transition-all opacity-0 group-hover:opacity-100
                          ${isDeleting
                            ? 'bg-red-500 text-white'
                            : 'bg-gray-100 text-gray-400 hover:text-red-500'
                          }
                        `}
                        title={isDeleting ? 'Confirmar eliminar' : 'Eliminar'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200">
          <p className="text-xs text-gray-400 text-center">
            {sessions.length} sesiones guardadas
          </p>
        </div>
      </aside>
    </>
  )
}
```

---

## 6. Integracion con el Chat/Agent

```typescript
// app/(main)/agent/page.tsx (ejemplo de integracion)

'use client'

import { useState, useEffect, useCallback, FormEvent } from 'react'
import { useAgentHistory } from '@/features/agent/hooks/useAgentHistory'
import { AgentSidebar } from '@/features/agent/components/AgentSidebar'
import type { AgentAction } from '@/features/agent/types'

export default function AgentPage() {
  const [actions, setActions] = useState<AgentAction[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const {
    sessions,
    currentSessionId,
    currentSession,
    isLoading: isLoadingHistory,
    saveActions,
    selectSession,
    deleteSession,
    startNewConversation,
    updateTitle,
  } = useAgentHistory()

  // Cargar acciones cuando se selecciona una sesion
  const handleSelectSession = useCallback(async (sessionId: string) => {
    try {
      const loadedActions = await selectSession(sessionId)
      // Convertir las acciones de DB a acciones de UI
      const uiActions: AgentAction[] = loadedActions.map((record) => ({
        ...record.content,
        _type: record.action_type,
        complete: true,
      } as AgentAction))
      setActions(uiActions)
    } catch (err) {
      console.error('Error loading session:', err)
    }
  }, [selectSession])

  // Nueva sesion
  const handleNewSession = useCallback(() => {
    startNewConversation()
    setActions([]) // Limpiar acciones locales
  }, [startNewConversation])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    setInput('')

    // Añadir mensaje del usuario
    const userAction: AgentAction = {
      _type: 'user_message',
      text: userMessage,
      complete: true,
    }
    setActions((prev) => [...prev, userAction])

    setIsStreaming(true)

    // Acciones a guardar al final
    const actionsToSave: AgentAction[] = [userAction]

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userMessage }),
      })

      // ... procesar streaming response ...
      // Agregar acciones completadas a actionsToSave

      // Guardar todas las acciones en PostgreSQL (batch)
      if (actionsToSave.length > 0) {
        try {
          await saveActions(
            actionsToSave.map((a) => ({
              actionType: a._type,
              content: { ...a },
            }))
          )

          // Auto-generar titulo de la primera pregunta
          if (!currentSession?.title || currentSession.title === 'Nueva sesion') {
            const titleFromMessage = userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '')
            updateTitle(titleFromMessage)
          }
        } catch (saveErr) {
          console.error('Error saving actions:', saveErr)
        }
      }
    } catch (error) {
      console.error('Stream error:', error)
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <AgentSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        isLoading={isLoadingHistory}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={deleteSession}
      />

      {/* Main Chat Area */}
      <main className="flex-1">
        {/* ... render actions y form ... */}
      </main>
    </div>
  )
}
```

---

## Checklist

- [ ] Modelos creados en Prisma (`AgentSession`, `AgentAction`)
- [ ] Migracion aplicada
- [ ] CHECK constraint para action_type
- [ ] Indices creados para performance
- [ ] `agentHistoryService` implementado
- [ ] `useAgentHistory` hook funcionando
- [ ] `AgentSidebar` con soporte mobile
- [ ] Batch save funcionando
- [ ] Auto-titulo funcionando
- [ ] Acciones se guardan y cargan correctamente

---

## Mejoras vs Template Original

| Feature | Original | Mejorado |
|---------|----------|----------|
| Schema | `conversations` + `messages` | `agent_sessions` + `agent_actions` |
| Content | TEXT simple | JSONB (objetos complejos) |
| Tipos | Solo `user`/`assistant` | 7 action types con CHECK |
| Save | Individual | Batch support |
| Titulo | Manual | Auto-generado |
| Modelo | No soportado | Guardado por sesion |
| Sidebar | Basico | Mobile + delete confirm |
| Indices | Basico | Optimizado para queries |

---

## 7. Memoria del Agente (IMPORTANTE)

> **Historial sin memoria es un log muerto.** Si guardas el historial, el modelo debe poder usarlo.

### 7.1 Funcion para Convertir Acciones a Historial

```typescript
// En tu pagina de agente o en un util
// Convierte las acciones de UI a formato de mensajes para el modelo

function actionsToHistory(
  actions: AgentAction[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = []

  for (const action of actions) {
    if (action._type === 'user_message' && action.text?.trim()) {
      history.push({ role: 'user', content: action.text })
    } else if (action._type === 'message' && action.text?.trim()) {
      history.push({ role: 'assistant', content: action.text })
    }
  }

  return history
}
```

### 7.2 Enviar Historial al API

```typescript
// En handleSubmit, antes del fetch:

const handleSubmit = async (e: FormEvent) => {
  // ...

  // Convertir acciones previas a historial para memoria
  const history = actionsToHistory(actions)

  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: userMessage,
      context,
      model: selectedModel,
      history, // ← NUEVO: Pasar historial
    }),
  })
  // ...
}
```

### 7.3 Usar Historial en el API Route

```typescript
// app/api/agent/route.ts

// Tipo para mensajes del historial
interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(req: Request) {
  const {
    prompt,
    context,
    model: modelKey,
    history = [] // ← NUEVO: Recibir historial
  } = await req.json() as {
    prompt: string
    context?: string
    model?: string
    history?: HistoryMessage[]
  }

  // ... setup del modelo ...

  // Construir mensajes con historial previo (ultimos 10)
  const previousMessages = history.slice(-10).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  }))

  const { textStream } = streamText({
    model: openrouter(modelId),
    system: systemPrompt,
    messages: [
      ...previousMessages,       // ← Mensajes anteriores
      { role: 'user', content: userContent }  // ← Mensaje actual
    ],
    temperature: 0,
  })

  // ... resto del streaming ...
}
```

### 7.4 Actualizar System Prompt

```typescript
const SYSTEM_PROMPT = `Eres un asistente con acceso a datos.

MEMORIA: Tienes acceso al historial de la conversacion.
Recuerda nombres, preferencias y contexto previo del usuario.

// ... resto del prompt ...
`
```

### Por que esto importa

| Sin Memoria | Con Memoria |
|-------------|-------------|
| Usuario: "Me llamo Juan" | Usuario: "Me llamo Juan" |
| AI: "Hola Juan!" | AI: "Hola Juan!" |
| Usuario: "Como me llamo?" | Usuario: "Como me llamo?" |
| AI: "No lo se" ❌ | AI: "Te llamas Juan" ✅ |

### Notas

- **Limitamos a 10 mensajes** para no exceder el contexto del modelo
- Solo convertimos `user_message` y `message`, ignoramos `think`, `analyze`, etc.
- El historial se pasa como mensajes previos, NO como parte del system prompt

---

## Checklist Actualizado

- [ ] Modelos creados en Prisma (`AgentSession`, `AgentAction`)
- [ ] Migracion aplicada
- [ ] `agentHistoryService` implementado
- [ ] `useAgentHistory` hook funcionando
- [ ] `AgentSidebar` con soporte mobile
- [ ] **`actionsToHistory()` implementado** ← NUEVO
- [ ] **Historial enviado al API** ← NUEVO
- [ ] **API usa mensajes previos en streamText** ← NUEVO
- [ ] Acciones se guardan y cargan correctamente

---

## Siguiente Bloque

- **Analizar imagenes**: `04-vision-analysis.md`
- **Agregar tools**: `05-tools-funciones.md`
