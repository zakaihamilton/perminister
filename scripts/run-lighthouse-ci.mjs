import { spawn } from "node:child_process";

const [executable, ...args] = process.argv.slice(2);

if (executable !== "lhci" || args.length === 0) {
  console.error("Expected a Lighthouse CI command after the wrapper script.");
  process.exit(2);
}

if (process.env.GITHUB_ACTIONS !== "true") {
  console.log("Lighthouse runs in GitHub Actions; skipping local browser launch.");
  process.exit(0);
}

const command = process.platform === "win32" ? "lhci.cmd" : executable;
const lighthouse = spawn(command, args, { stdio: "inherit" });

lighthouse.on("error", (error) => {
  console.error(`Unable to start Lighthouse CI: ${error.message}`);
  process.exitCode = 1;
});

lighthouse.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Lighthouse CI exited after ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
