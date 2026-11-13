// A second process writing to a DevvaStore, for test/store-devva-kill.test.ts.
//   devva-writer.ts <prefix> <count>   inserts <count> machine_state rows, printing "ACK <n>" after each returns
import { DevvaStore } from "../../src/store/devva.js";

const [prefix, count] = process.argv.slice(2);
const store = await DevvaStore.open({ prefix: prefix! });
const start = await store.read((r) => r.count("machineState"));
for (let i = 1; i <= Number(count); i++) {
  await store.write("", {}, async (uow) => {
    await uow.insert("machineState", { key: `k${start + i}`, value: { n: start + i } });
    await uow.insert("events", { projectId: "00000000-0000-4000-8000-000000000001", type: "kill.test", actor: { agent: "t", session_id: "s" }, payload: { n: start + i } });
  });
  console.log(`ACK ${start + i}`);
}
store.close();
