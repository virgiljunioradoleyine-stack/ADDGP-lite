import { BRAND } from "../../brand.ts";
import { log, color, UserError } from "../../util/log.ts";
import { startUi } from "../../ui/server.ts";
import { heading } from "../ui.ts";
import { flagBool, flagString, type ParsedArgs } from "../args.ts";
import { requireConfig } from "./setup.ts";

export async function cmdUi(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const portFlag = flagString(args.flags, "port");
  const port = portFlag ? Number(portFlag) : undefined;
  if (portFlag && (!Number.isInteger(port) || port! < 1 || port! > 65535)) {
    throw new UserError(`--port ${portFlag} is not a valid port.`, "Use a number between 1 and 65535, or leave it out.");
  }

  const ui = startUi({ cfg, p, port });

  heading(`${BRAND.display} — local UI`);
  log.raw(`  ${color.bold(ui.url)}`);
  log.blank();
  log.raw(color.gray(`  Served on 127.0.0.1 only. Read-only: it shows this project's local state and calls no model.`));
  log.raw(color.gray(`  The link carries a one-time session token — don't share it. Ctrl+C to stop.`));
  log.blank();

  if (!flagBool(args.flags, "no-open")) openBrowser(ui.url);

  await new Promise<void>((resolve) => {
    const stop = () => {
      ui.stop();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  log.blank();
  return 0;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  try {
    Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  } catch {
    // No browser launcher available (headless box, SSH): the printed link is enough.
  }
}
