---
name: reflect-on-correction
description: Judges one owner correction of an agent's delivery and answers new, repeats, conflicts or one_off with at most one short rule. Use for every correction Plania hands the reflector.
---

# Reflect on a correction

1. Read the owner's words twice. Name what they asked to be different in one sentence, to yourself.
2. Ask: would the same request apply to the next delivery of this kind? If not, `one_off`.
3. Compare with each existing lesson. Same rule in other words: `repeats` with its id. The opposite
   rule: `conflicts` with its id.
4. Otherwise `new`. Write the rule the way the owner would say it, general enough for the next delivery
   and specific enough to check: "Una sola acción principal por pantalla, abajo a la derecha", not
   "Mejorar el diseño".
5. Refuse to generalise from anything that is not the owner's words, and never write a rule that skips
   a check, a test or a review.

## Done when

The JSON has a verdict, a lesson for `new` and `conflicts`, a lesson id for `repeats` and `conflicts`,
and a one-line why.

Origin: PLA-I67-3 seed, 2026-11-19, written with the lessons feature before any reflector run existed.
