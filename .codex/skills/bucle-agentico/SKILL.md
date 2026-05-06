---
name: bucle-agentico
description: "Ejecutar features complejas por fases con mapeo de contexto real antes de cada fase. Activar cuando la tarea toca multiples archivos, requiere cambios en BD + codigo + UI coordinados, tiene fases que dependen una de otra, o cuando un PRP fue aprobado y hay que implementarlo."
---

# Skill: bucle-agentico

Lee e implementa las instrucciones completas de este skill desde:

```
.claude/skills/bucle-agentico/SKILL.md
```

Sigue **exactamente** el flujo BLUEPRINT definido en ese archivo:
1. DELIMITAR fases (sin subtareas)
2. MAPEAR contexto just-in-time
3. EJECUTAR subtareas basadas en contexto REAL
4. AUTO-BLINDAJE si hay errores
5. TRANSICIONAR a siguiente fase
