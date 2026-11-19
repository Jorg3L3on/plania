---
name: revision-de-seguridad
description: "antes de abrir o aprobar un PR que toca login, permisos, datos de usuarios, rutas de API, archivos subidos o secretos."
---

# Revisión de seguridad

Cuándo: antes de abrir o aprobar un PR que toca login, permisos, datos de usuarios, rutas de API, archivos subidos o secretos.

Paquete de habilidad de Plania (PLA-I46-12). Vive en Plania; el runner lo copia a la copia de trabajo solo mientras corre tu rol. Nunca lo subas al repo.

## Recorre el diff con estas preguntas
1. **Quién puede llamar esto.** Cada ruta nueva revisa sesión y permisos. Sin sesión: 401. Sin permiso: 403. Pruébalo.
2. **Qué entra.** Toda entrada se valida (tipo, largo, formato) antes de usarse. Nada de SQL armado con texto: consultas con parámetros.
3. **Qué sale.** Las respuestas no llevan tokens, contraseñas, rutas locales de la máquina ni datos de otro usuario. Los errores no muestran el stack.
4. **Secretos.** Ningún secreto en el código, en los logs ni en el PR. Solo nombres de variables de entorno; los valores viven fuera del repo. `.env` nunca se sube.
5. **Archivos y enlaces.** Un nombre de archivo o una ruta del usuario no sale de su carpeta (`..`). Un enlace externo no se sigue a ciegas.
6. **HTML.** Lo que escribe un usuario se escapa al mostrarse. Nada de `dangerouslySetInnerHTML` con texto del usuario.
7. **Dependencias.** Un paquete nuevo: ¿hace falta?, ¿es conocido y mantenido?, ¿es gratis? Si cuesta dinero, detente y avisa.

## Qué reportar
- add_result kind security: verdict, el commit y una línea por hallazgo con archivo:línea, el riesgo y el arreglo.
- Un hallazgo grave bloquea el PR: devuélvelo con la razón. Uno menor va como nota.
- Si no encontraste nada, dilo y di qué revisaste.

## Reglas
- No pruebes contra producción ni contra datos reales.
- No publiques un hallazgo fuera de Plania.
