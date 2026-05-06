---
name: primer
description: "Cargar contexto completo del proyecto al inicio de una conversacion. Lee BUSINESS_LOGIC.md, estructura de features, estado de la BD, y configuracion actual. Activar cuando el agente no tiene contexto del proyecto o el usuario dice: que tenemos, donde estamos, dame contexto, resumeme el proyecto."
allowed-tools: Read, Grep, Glob, Bash
---

# Skill: primer

Lee e implementa las instrucciones completas de este skill desde:

```
.claude/skills/primer/SKILL.md
```

Sigue **exactamente** el flujo definido en ese archivo.

> Nota: Los skills de este proyecto estan en `.claude/skills/` (implementacion completa)
> y en `.codex/skills/` (stubs para Codex). Ambos son validos.
