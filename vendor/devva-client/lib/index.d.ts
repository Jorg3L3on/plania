/**
 * devva — TypeScript/JavaScript driver for devva engine.
 *
 * A thin client for [devva engine]() that speaks the
 * binary wire protocol directly over a Node TCP socket. It does **not** embed the
 * engine; it is one of three renderings of the same protocol (Python / Rust /
 * TypeScript) in the `devva-clients` monorepo, aligned to the current **xyTalk
 * v1** surface.
 *
 * ```ts
 * import { connect } from "devva";
 *
 * const db = await connect("127.0.0.1", 2505);
 * await db.createLobe("clients", "Customer records");
 * await db.createAnchor("rfc", "clients");
 * await db.put("clients", { rfc: "ACME-001", name: "Acme Corp" });
 *
 * const acme = await db.find("clients", { rfc: "ACME-001" }).one();
 * console.log(acme?.getString("name"));
 * db.close();
 * ```
 *
 * Authentication is transparent: if `DEVVA_TOKEN` is set, the bearer token is
 * sent on connect. A {@link Client} owns one TCP connection (requests are
 * serialised); use one per logical session.
 */
export { Client, connect, metric, QueryBuilder } from "./client.js";
export type { AnchorInfo, EmbedderIdentity, LinkTo, LobeInfo, NearestQuery, PutOptions, Scalar, WhereInput, WhereObject, WhereValue, } from "./client.js";
export { AggregateResult, Record, RecordSet } from "./types.js";
export type { BudgetStop, Fields } from "./types.js";
export { CLIENT_ERROR_CODES, ConnectionError, SERVER_ERROR_CODES, TimeoutError, DevvaError, } from "./errors.js";
