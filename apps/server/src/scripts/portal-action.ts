/* eslint-disable no-console -- command-line tool: console is its output */
import { parseArgs } from "node:util";

import { PortalSession } from "../modules/portal-bid/portal/portal-session.js";

const { values } = parseArgs({
  options: { action: { type: "string" }, cdp: { type: "string", default: "http://127.0.0.1:9222" } },
});

/** One explicit toolbar step on the open response: `save` or `edit`. Never Check or Submit. */
async function main(): Promise<void> {
  const session = await PortalSession.attach(values.cdp!);
  const header = await session.readHeader();
  if (values.action === "save") await session.save();
  else if (values.action === "edit") await session.edit();
  else throw new Error("usage: portal:action --action save|edit [--cdp <url>]");
  console.log(`${values.action} done on response ${header.responseNumber} (RFx ${header.rfxNumber})`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
