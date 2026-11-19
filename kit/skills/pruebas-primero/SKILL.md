---
name: pruebas-primero
description: "antes de cambiar código que tiene, o debería tener, pruebas (un arreglo, una función nueva, una regla)."
---

# Pruebas primero

Cuándo: antes de cambiar código que tiene, o debería tener, pruebas (un arreglo, una función nueva, una regla).

Paquete de habilidad de Plania (PLA-I46-12). Vive en Plania; el runner lo copia a la copia de trabajo solo mientras corre tu rol. Nunca lo subas al repo.

## El ciclo
1. **Rojo.** Escribe primero la prueba que describe lo que el ticket pide. Córrela y mira que falle por la razón correcta (no por un import roto o un typo).
2. **Verde.** Haz el cambio más pequeño que la hace pasar. Nada de extras.
3. **Limpio.** Ordena el código con las pruebas en verde. Si una limpieza rompe algo, regresa.
4. **Toda la suite.** Corre la suite completa y el typecheck del proyecto. Lo que ya fallaba antes, anótalo; no lo escondas.
5. **PR.** Commit, push y PR a sandbox. En el cuerpo: «Plania: <KEY>», qué prueba fallaba antes y pasa ahora, y el comando que corriste.

## Reglas
- Una prueba por cada check del ticket. Si un check no se puede probar con código, dilo en la evidencia.
- Las pruebas usan la base de datos de prueba o fakes. Nunca una base viva, nunca un servicio de pago.
- No borres ni debilites una prueba para que pase. Si la prueba está mal, explícalo en el PR.
- Un bug: primero la prueba que lo reproduce, luego el arreglo.
- Evidencia en Plania: add_result con kind test o unit, el commit, el comando y los conteos (pass, fail).

## Señales de que lo estás haciendo mal
- Escribiste el código y luego la prueba que «ya pasa».
- La prueba revisa detalles internos en lugar de lo que ve el usuario o el contrato.
- La suite tarda o falla al azar y lo ignoras.
