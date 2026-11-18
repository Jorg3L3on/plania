// PLA-98 (guided test PLA-86): Mianovia's floor went blank in a 303 px pane: the list's fit effect took its overflow off
// the room on every render until React's update limit. shouldRefit bounds it.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";

(globalThis as { React?: unknown }).React = React;
const todo = (await import(new URL("../ui/src/components/corriente/todo.tsx", import.meta.url).href)) as Record<string, any>;

test("PLA-98: the fit correction stops after a few tries, at the room, or when nothing overflows", () => {
  assert.equal(todo.shouldRefit(40, 0, 0, 200), true);
  assert.equal(todo.shouldRefit(2, 0, 0, 200), false, "a 2 px overflow is not worth a render");
  assert.equal(todo.shouldRefit(40, todo.MAX_FIT_TRIES, 0, 200), false, "a list that still overflows after the tries scrolls");
  assert.equal(todo.shouldRefit(40, 1, 200, 200), false, "never past the room itself");
  assert.equal(todo.shouldRefit(40, 0, 0, undefined), true);
  // A short pane: the overflow never goes away; the tries end it.
  let tries = 0;
  let over = 0;
  while (todo.shouldRefit(500, tries, over, 120)) {
    tries += 1;
    over += 500;
  }
  assert.ok(tries <= todo.MAX_FIT_TRIES);
});
