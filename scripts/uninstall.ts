// PLA-I2-18: pnpm uninstall:plania — stops and removes Plania's service and processes. The database and folders stay.
// pnpm uninstall:plania --delete-data also drops the database and Plania's folders, after you type the database's
// name. Backups (~/plania-backups) are never removed. Export your projects first from Plomería if you want them.
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { uninstall } from "../src/uninstall/index.js";

const { values } = parseArgs({ options: { "delete-data": { type: "boolean", default: false } }, strict: true });

const prompt = async (question: string) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};

const r = await uninstall({ deleteData: values["delete-data"] }, { root: path.resolve(import.meta.dirname, ".."), prompt });
process.exit(r.left.length ? 1 : 0);
