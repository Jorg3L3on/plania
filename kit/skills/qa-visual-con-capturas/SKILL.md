---
name: qa-visual-con-capturas
description: "al verificar una entrega con pantalla (un ticket de UI o cualquier cambio que el dueño vaya a ver en la app)."
---

# QA visual con capturas

Cuándo: al verificar una entrega con pantalla (un ticket de UI o cualquier cambio que el dueño vaya a ver en la app).

Paquete de habilidad de Plania (PLA-I46-12). Vive en Plania; el runner lo copia a la copia de trabajo solo mientras corre tu rol. Nunca lo subas al repo.

## Antes de empezar
- Lee el ticket: sus checks y la «Check list del PO». Esa es tu lista de verificación; no inventes otra.
- Levanta la copia de prueba del proyecto en la máquina local (nunca producción, nunca una base viva). Si necesita login, usa el usuario de prueba del proyecto.

## La pasada
1. Por cada punto de la lista: abre la página, haz lo que el punto dice y mira el resultado.
2. Toma captura de escritorio a 1280 px y de teléfono a 390 px de cada pantalla que toca el ticket.
3. Revisa a 390: nada cortado, sin scroll horizontal, las filas envuelven, un solo botón principal.
4. Revisa los estados: vacío, cargando, error y con datos, si el ticket los tiene.
5. Mira la consola del navegador: cero errores nuevos.

## Qué reportar
- add_result kind visual (o e2e), verdict pass, warn o fail, con viewport, el commit y una línea por punto: «3 de 3».
- Las capturas van a Plania como adjuntos del resultado. Nunca al repo de la app.
- Si algo falla: qué hiciste, qué esperabas, qué viste, y la captura. Devuélvelo a Taller con una razón corta.

## Reglas
- No arregles tú el código; tu trabajo es ver y reportar.
- «Se ve bien» no es evidencia. Cada punto lleva su captura o su paso.
- No aceptes ni publiques solo: eso es del dueño.
