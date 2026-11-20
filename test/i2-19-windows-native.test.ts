// PLA-I2-19 (audit B5): native Windows is a supported system. The service (a per-user Scheduled Task and its
// supervisor), the shell and process-tree stop the test copy, QA and the runner use, and the process command line.
// No database, no real schtasks, taskkill or PowerShell: every outside call is a fake.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";
import {
  applyPlan,
  installPlan,
  restartCommand,
  serviceInstalled,
  servicePlatform,
  startCommand,
  stopCommand,
  supervisorConfig,
  uninstallPlan,
  windowsPaths,
  windowsTaskXml,
  winQuote,
  type ServiceEnv,
} from "../src/packaging/service.js";
import { createSupervisor, pipeName, type ServerChild } from "../src/packaging/win-supervisor.js";
import { killTree, shellCommand } from "../src/lib/proc-tree.js";
import { processCommand } from "../src/lib/proc-command.js";
import { drainOnParentRequest, SHUTDOWN_MESSAGE } from "../src/ops/shutdown.js";

const win: ServiceEnv = {
  platform: "win32",
  home: "C:\\Users\\Ana León",
  uid: -1,
  root: "C:\\Users\\Ana León\\plania",
  node: "C:\\Program Files\\nodejs\\node.exe",
  path: "C:\\Program Files\\nodejs;C:\\Windows\\System32",
  port: 3737,
  systemd: false,
  wsl: false,
  localAppData: "C:\\Users\\Ana León\\AppData\\Local",
  user: "PC\\Ana León",
  systemRoot: "C:\\WINDOWS",
};
const lad = "C:\\Users\\Ana León\\AppData\\Local\\plania";
// The task's files: outside AppData, which a packaged app's shell would redirect.
const cfg = "C:\\Users\\Ana León\\.config\\plania";

describe("Windows service: a Scheduled Task at logon", () => {
  test("the task runs the supervisor hidden, as this user, with no admin rights, and restarts on failure", () => {
    assert.equal(servicePlatform(win), "win32");
    const xml = windowsTaskXml(win);
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-16"\?>/);
    assert.match(xml, /<LogonTrigger>\s*<Enabled>true<\/Enabled>\s*<UserId>PC\\Ana León<\/UserId>/);
    assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>\s*<RunLevel>LeastPrivilege<\/RunLevel>/);
    assert.match(xml, /<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>999<\/Count>/);
    // A dead supervisor is not a task failure (conhost exits 0): a 5-minute check starts it again.
    assert.match(xml, /<TimeTrigger>\s*<Repetition>\s*<Interval>PT5M<\/Interval>/);
    assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
    assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
    assert.match(xml, /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/);
    assert.match(xml, /<Command>C:\\WINDOWS\\System32\\conhost\.exe<\/Command>/);
    assert.match(
      xml,
      /<Arguments>--headless &quot;C:\\Program Files\\nodejs\\node\.exe&quot; --import tsx &quot;C:\\Users\\Ana León\\plania\\scripts\\service-win\.ts&quot; run<\/Arguments>/,
    );
    assert.match(xml, /<WorkingDirectory>C:\\Users\\Ana León\\plania<\/WorkingDirectory>/);
  });

  test("names with & or < stay valid XML", () => {
    assert.match(windowsTaskXml({ ...win, root: "C:\\A & B" }), /<WorkingDirectory>C:\\A &amp; B<\/WorkingDirectory>/);
  });

  test("install writes the UTF-16 task and the supervisor's settings, stops an old supervisor, registers and starts", () => {
    const plan = installPlan(win);
    assert.deepEqual(plan.dirs, [cfg, `${lad}\\logs`]);
    assert.deepEqual(plan.files.map((f) => [f.path, f.encoding ?? "utf8"]), [
      [`${cfg}\\plania-task.xml`, "utf16le"],
      [`${cfg}\\service.json`, "utf8"],
    ]);
    assert.ok(plan.files[0]!.content.startsWith("\uFEFF<?xml"));
    assert.deepEqual(JSON.parse(plan.files[1]!.content), supervisorConfig(win));
    assert.deepEqual(supervisorConfig(win), {
      root: win.root,
      port: 3737,
      path: win.path,
      log: `${lad}\\logs\\server.log`,
      command: win.node,
      args: ["--env-file=C:\\Users\\Ana León\\plania\\.env", "--import", "tsx", "C:\\Users\\Ana León\\plania\\scripts\\dev.ts", "--port", "3737"],
    });
    const log: string[] = [];
    applyPlan(plan, {
      mkdir: (d) => log.push(`mkdir ${d}`),
      write: (f, _c, enc) => log.push(`write ${f} ${enc ?? "utf8"}`),
      remove: (f) => log.push(`rm ${f}`),
      run: (cmd, args) => {
        log.push(`${cmd} ${args.join(" ")}`);
        if (args.at(-1) === "stop") throw new Error("no supervisor");
      },
    });
    assert.deepEqual(log, [
      `mkdir ${cfg}`,
      `mkdir ${lad}\\logs`,
      `write ${cfg}\\plania-task.xml utf16le`,
      `write ${cfg}\\service.json utf8`,
      `${win.node} --import tsx ${win.root}\\scripts\\service-win.ts stop`,
      `schtasks /Create /TN Plania /XML ${cfg}\\plania-task.xml /F`,
      `${win.node} --import tsx ${win.root}\\scripts\\service-win.ts start`,
    ]);
    assert.match(plan.lines.join("\n"), /logs\\server\.log/);
  });

  test("with no Windows user it writes nothing and says why", () => {
    const plan = installPlan({ ...win, user: undefined });
    assert.deepEqual([plan.files, plan.commands], [[], []]);
    assert.equal(plan.platform, "unsupported");
    assert.match(plan.lines.join(" "), /USERNAME/);
  });

  test("uninstall stops the supervisor, deletes the task and its files; data and logs stay", () => {
    const log: string[] = [];
    applyPlan(uninstallPlan(win), {
      mkdir: () => undefined,
      write: () => undefined,
      remove: (f) => log.push(`rm ${f}`),
      run: (cmd, args) => {
        log.push(`${cmd} ${args.join(" ")}`);
        throw new Error("not there");
      },
    });
    assert.deepEqual(log, [
      `${win.node} --import tsx ${win.root}\\scripts\\service-win.ts stop`,
      "schtasks /Delete /TN Plania /F",
      `rm ${cfg}\\plania-task.xml`,
      `rm ${cfg}\\service.json`,
      `rm ${cfg}\\service.stopped`,
    ]);
  });

  test("restart and stop go to the supervisor, start to the task; installed means the task XML is there", () => {
    assert.deepEqual(restartCommand(win), { cmd: win.node, args: ["--import", "tsx", `${win.root}\\scripts\\service-win.ts`, "restart"] });
    assert.deepEqual(stopCommand(win), { cmd: win.node, args: ["--import", "tsx", `${win.root}\\scripts\\service-win.ts`, "stop"] });
    assert.deepEqual(startCommand(win), { cmd: win.node, args: ["--import", "tsx", `${win.root}\\scripts\\service-win.ts`, "start"] });
    assert.equal(startCommand({ ...win, node: undefined }), null);
    assert.equal(serviceInstalled(win, (p) => p === `${cfg}\\plania-task.xml`), true);
    assert.equal(serviceInstalled(win, () => false), false);
    // Without LOCALAPPDATA, the default under the home folder.
    assert.equal(windowsPaths({ home: "C:\\Users\\x" }).log, "C:\\Users\\x\\AppData\\Local\\plania\\logs\\server.log");
  });

  test("Windows command-line quoting", () => {
    assert.equal(winQuote("run"), "run");
    assert.equal(winQuote("C:\\Program Files\\x"), '"C:\\Program Files\\x"');
    assert.equal(winQuote('a"b'), '"a\\"b"');
    assert.equal(winQuote("C:\\dir with space\\"), '"C:\\dir with space\\\\"');
    assert.equal(winQuote(""), '""');
  });
});

// A fake server process for the supervisor.
class FakeChild extends EventEmitter implements ServerChild {
  static next = 1000;
  pid = FakeChild.next++;
  sent: unknown[] = [];
  killed = false;
  constructor(private readonly drains: boolean) {
    super();
  }
  send = (m: { type: string }) => {
    this.sent.push(m);
    if (this.drains) setImmediate(() => this.emit("exit", 143, null));
    return true;
  };
  kill = () => {
    this.killed = true;
    setImmediate(() => this.emit("exit", 1, null));
  };
}

function rig(opts: { drains?: boolean } = {}) {
  const children: FakeChild[] = [];
  const lines: string[] = [];
  const timers: { fn: () => void; ms: number; done: boolean }[] = [];
  const exits: number[] = [];
  const spawned: { cmd: string; args: string[]; cwd: string; path?: string }[] = [];
  const config = supervisorConfig(win);
  const sup = createSupervisor(config, {
    spawn: (cmd, args, o) => {
      spawned.push({ cmd, args, cwd: o.cwd, path: o.env.PATH });
      const c = new FakeChild(opts.drains ?? true);
      children.push(c);
      return c;
    },
    env: { PATH: "C:\\other", SystemRoot: "C:\\WINDOWS" },
    log: (l) => void lines.push(l),
    // Timers fire only when the test says so, except the short ones (the stop's exit and the drain race).
    setTimer: (fn, ms) => {
      const t = { fn, ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => void ((t as { done: boolean }).done = true),
    exit: (code) => void exits.push(code),
    markStopped: () => void lines.push("(marked stopped)"),
  });
  const fire = (ms: number) => {
    for (const t of timers.filter((x) => x.ms === ms && !x.done)) {
      t.done = true;
      t.fn();
    }
  };
  return { sup, children, lines, timers, exits, spawned, fire };
}

describe("Windows service: the supervisor", () => {
  test("starts the server from the package with the installer's PATH, and again 10 s after a crash", () => {
    const r = rig();
    r.sup.start();
    assert.equal(r.spawned.length, 1);
    assert.deepEqual(r.spawned[0], { cmd: win.node, args: supervisorConfig(win).args, cwd: win.root, path: win.path });
    r.children[0]!.emit("exit", 1, null);
    assert.equal(r.spawned.length, 1);
    assert.match(r.lines.at(-1)!, /exited \(1\); starting it again in 10 s/);
    r.fire(10_000);
    assert.equal(r.spawned.length, 2);
  });

  test("restart asks the server to drain over IPC, then starts a new one; no crash restart in between", async () => {
    const r = rig();
    r.sup.start();
    const answer = await r.sup.request("restart");
    assert.equal(answer, "ok");
    assert.deepEqual(r.children[0]!.sent, [{ type: SHUTDOWN_MESSAGE }]);
    assert.equal(r.children[0]!.killed, false);
    assert.equal(r.spawned.length, 2);
    assert.ok(!r.timers.some((t) => t.ms === 10_000 && !t.done));
  });

  test("a server that does not drain is ended (that process only) when the wait runs out", async () => {
    const r = rig({ drains: false });
    r.sup.start();
    const pending = r.sup.request("restart");
    await new Promise((res) => setImmediate(res));
    r.fire(20_000);
    assert.equal(await pending, "ok");
    assert.equal(r.children[0]!.killed, true);
    assert.equal(r.spawned.length, 2);
  });

  test("stop drains the server and the supervisor exits 0, so the task does not count it as a failure", async () => {
    const r = rig();
    r.sup.start();
    assert.equal(await r.sup.request("stop"), "ok");
    assert.equal(r.spawned.length, 1);
    r.fire(200);
    assert.deepEqual(r.exits, [0]);
    assert.ok(r.lines.includes("(marked stopped)"), "the 5-minute check will not start it again");
    assert.equal(await r.sup.request("status"), "waiting");
    assert.equal(await r.sup.request("nonsense"), "unknown");
  });

  test("the pipe is per port", () => {
    assert.equal(pipeName(3737), "\\\\.\\pipe\\plania-service-3737");
  });
});

describe("the server drains on the supervisor's request", () => {
  test("a message or the channel closing drains; without IPC nothing is hooked", () => {
    const proc = new EventEmitter() as EventEmitter & { send?: () => boolean };
    proc.send = () => true;
    let drained = 0;
    assert.equal(drainOnParentRequest(proc as never, () => drained++), true);
    proc.emit("message", { type: "other" });
    assert.equal(drained, 0);
    proc.emit("message", { type: SHUTDOWN_MESSAGE });
    proc.emit("disconnect");
    assert.equal(drained, 2);
    assert.equal(drainOnParentRequest(new EventEmitter() as never, () => drained++), false);
  });
});

describe("shell commands and process trees", () => {
  test("cmd.exe on Windows, /bin/sh elsewhere", () => {
    assert.deepEqual(shellCommand("npm run dev", "win32", { ComSpec: "C:\\WINDOWS\\system32\\cmd.exe" }), {
      file: "C:\\WINDOWS\\system32\\cmd.exe",
      args: ["/d", "/s", "/c", '"npm run dev"'],
      options: { windowsVerbatimArguments: true, windowsHide: true },
    });
    assert.equal(shellCommand("x", "win32", {}).file, "cmd.exe");
    assert.deepEqual(shellCommand("npm run dev", "darwin"), { file: "/bin/sh", args: ["-c", "npm run dev"], options: {} });
  });

  test("Windows ends the tree with taskkill /T /F; macOS and Linux signal the group, then the pid", () => {
    const calls: string[] = [];
    killTree(42, "SIGINT", { platform: "win32", taskkill: (a) => void calls.push(`taskkill ${a.join(" ")}`), kill: () => assert.fail("no signals on Windows") });
    assert.deepEqual(calls, ["taskkill /T /F /PID 42"]);
    const sent: string[] = [];
    killTree(42, "SIGTERM", {
      platform: "linux",
      kill: (pid, s) => {
        sent.push(`${pid} ${s}`);
        if (pid < 0) throw new Error("ESRCH");
      },
    });
    assert.deepEqual(sent, ["-42 SIGTERM", "42 SIGTERM"]);
    killTree(0, "SIGKILL", { platform: "win32", taskkill: () => assert.fail("no pid") });
  });

  test("a process's command line comes from CIM on Windows", async () => {
    assert.equal(await processCommand(7, { platform: "win32", cim: async (pid) => `node wrapper.mjs ${pid}`, ps: async () => assert.fail("no ps") }), "node wrapper.mjs 7");
  });
});
