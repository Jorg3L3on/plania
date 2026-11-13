// A second process that writes to the same store. Modes:
//   inc <prefix> <project> <name> <count>     read-modify-write increments
//   stream <prefix> <project> <count>         create tasks, print "ACK <seq>" after each returns
//   one <prefix> <project>                    one create_task (used with SPIKE_CRASH)
import { createTask, increment } from "./domain.js";
import { Store } from "./store.js";

const [mode, prefix, project, a, b] = process.argv.slice(2);
if (!mode || !prefix || !project) throw new Error("usage: worker <mode> <prefix> <project> ...");
const store = await Store.open({ prefix });

if (mode === "inc") {
  for (let i = 0; i < Number(b); i++) await increment(store, project, a ?? "n");
  console.log(`STATS ${JSON.stringify(store.stats)}`);
} else if (mode === "stream") {
  for (let i = 0; i < Number(a); i++) {
    await createTask(store, project, `task ${i}`);
    console.log(`ACK ${store.head}`);
  }
} else if (mode === "one") {
  await createTask(store, project, "written by a process that dies");
  console.log(`ACK ${store.head}`);
}
store.close();
