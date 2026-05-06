---
name: memory-manager
description: "Memoria persistente POR PROYECTO en .claude/memory/. Guardar y recuperar contexto entre sesiones: decisiones de arquitectura, preferencias del usuario, errores conocidos, estado de iniciativas. Activar cuando el usuario dice: recuerda que, guarda esto, en que quedamos, memoria del proyecto."
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Skill: memory-manager

Lee e implementa las instrucciones completas de este skill desde:

```
.claude/skills/memory-manager/SKILL.md
```

La memoria del proyecto vive en `.claude/memory/MEMORY.md` y sus subdirectorios.

Sigue **exactamente** el flujo definido en ese archivo.
