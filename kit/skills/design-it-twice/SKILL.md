---
name: design-it-twice
description: Explores two or three clearly different design directions before committing to one, and labels every frame with what it does and why. Use when Artist designs an idea at the design stage, redesigns a screen or a flow, or is about to draw the first solution that came to mind.
---

# Design it twice

The first design you think of is only the first. Drawing a second and a third that are really different
is cheap, and it is the only way to know the first was any good. The owner sees your work only through
the frames in Plania, so each frame explains itself.

## Plania tools

- `get_task` and `get_doc`: the idea, its Idea doc and its Research doc.
- `get_memory`: design docs and decisions that already bind the design.
- `attach_frames`: the frames, on the idea. One call carries the whole set; a new call replaces it.
- `attach_doc`: `title: "Design"` with the headings `Approach`, `Scope`, `Out of scope` (English,
  exactly; the stage move checks them).
- `set_task`: `stage: "planning"` once the doc is attached. An idea is not a ticket: never `start` it.
- `thread_post`: the closing line, with a link of kind `idea`.

## Steps

1. **Say the job of the screen in one sentence**: what the person in `Who it is for` must be able to do.
   Every direction is judged against this sentence.
2. **Find two or three directions that differ in structure.** What counts as different:
   - what is on the first screen;
   - the order of the steps, or how many there are;
   - where the main action lives;
   - one screen or several; a list, a map, a conversation, a form.

   What does not count: colour, type, corner radius, spacing, wording.

   Test: describe each direction in one sentence without naming anything visual. If two sentences say
   the same, you have one direction.
3. **Name each by its idea**: «A · Todo en una pantalla», «B · Paso a paso».
4. **Draw only the key frames of each**, two to four: the first screen and the hardest moment. Use the
   same content in every direction so they can be compared, with real text in the app's language and
   believable data. If the app is used on a phone, draw at phone width.
5. **Compare.** For each direction: what it makes easy, what it makes hard, and roughly what it costs
   to build. Compare against the job, not against your taste.
6. **Choose one.** Two sentences on why, and one on what you took from the others.
7. **Finish the chosen direction**: every frame a builder needs, including the empty, loading, error
   and full states.

## The frames

Export one image per frame (PNG, JPEG or WebP, up to 5 MB each, up to 40) into the canvas folder the
run prompt names, then call `attach_frames` once with all of them, in the order to show them.

| Field | What to write |
|---|---|
| `id` | Short: `T` for the overview, then `A1`, `A2`, `B1`… by direction |
| `name` | What the frame is, in a few words |
| `group` | The direction's name. The chosen one first; the others end with «(descartada)» |
| `hace` | What the frame lets the person do |
| `porque` | Why it is this way: the reason, tied to the job, the research or a decision |

`hace` and `porque` are plain words in the owner's language, up to 400 characters each. «Moderno», «limpio» and «intuitivo»
are not reasons. A frame with nothing to say in `porque` probably should not exist.

Keep the key frames of the discarded directions in the set. The owner should see what was considered
and may prefer one of them.

A path outside the canvases folder is `FRAME_INVALID`.

## The Design doc

Plain words in the owner's language under the English headings.

- `Approach`: the chosen direction and why; then each discarded direction in one line with why not.
- `Scope`: what the design covers, as things a person can do.
- `Out of scope`: what it leaves out on purpose, with the reason.

## Done when

- At least two directions exist and differ in structure, not in paint.
- Every frame has `hace` and `porque`.
- One direction is chosen, with the reason, and its frames cover every state.
- `attach_frames` accepted the whole set and the Design doc is attached.
- The idea's stage moved to `planning`.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents a design stage that delivers one polished direction nobody compared with anything, in frames the owner has to guess the purpose of.
