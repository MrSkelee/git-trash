#!/usr/bin/env node
import pc from "picocolors";
import { clean, discard, undo, list } from "./core.js";

const HELP_TEXT = `
${pc.bold(pc.cyan("git-trash"))} — The OS Recycle Bin for Git 🗑️

Safely move untracked and discarded files to your system Trash instead of permanent deletion.

${pc.bold("USAGE:")}
  ${pc.green("git trash")} [command] [options]
  ${pc.green("npx git-trash")} [command] [options]

${pc.bold("COMMANDS:")}
  ${pc.yellow("clean")} (default)      Move untracked files to OS Recycle Bin (safe 'git clean')
  ${pc.yellow("discard")} [paths...]   Safely discard uncommitted edits with snapshot backup
  ${pc.yellow("undo")}                 Instantly restore last trashed or discarded batch
  ${pc.yellow("list")}                 List previous trash sessions

${pc.bold("OPTIONS:")}
  ${pc.cyan("-n, --dry-run")}          Preview files without trashing them
  ${pc.cyan("-x, --include-ignored")}  Also trash ignored files (.gitignore)
  ${pc.cyan("-h, --help")}             Show this help message
  ${pc.cyan("-v, --version")}          Show version

${pc.bold("EXAMPLES:")}
  git trash                     # Move untracked files to OS Trash
  git trash -n                  # Preview untracked files (dry run)
  git trash discard .           # Discard modified files (safely snapshotted)
  git trash undo                # Made a mistake? Undo it immediately!
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help") || args.includes("help")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (args.includes("-v") || args.includes("--version")) {
    console.log("git-trash v1.0.1");
    process.exit(0);
  }

  const dryRun = args.includes("-n") || args.includes("--dry-run");
  const includeIgnored = args.includes("-x") || args.includes("--include-ignored");

  // Filter out flag arguments to get command and positional params
  const positional = args.filter((a) => !a.startsWith("-"));
  const command = positional[0] || "clean";

  try {
    switch (command) {
      case "clean": {
        await clean({ dryRun, includeIgnored });
        break;
      }

      case "discard": {
        const targets = positional.slice(1);
        await discard(targets, { dryRun });
        break;
      }

      case "undo": {
        undo();
        break;
      }

      case "list":
      case "history": {
        list();
        break;
      }

      default: {
        // If the user specified paths directly like `git trash file1 file2`
        // or unknown command, check if they meant discard or clean
        if (positional.length > 0 && !["clean", "discard", "undo", "list"].includes(command)) {
          // Assume discard of targeted files
          await discard(positional, { dryRun });
        } else {
          await clean({ dryRun, includeIgnored });
        }
        break;
      }
    }
  } catch (err: any) {
    console.error(pc.red(`\n✖ git-trash error: ${err.message || String(err)}\n`));
    process.exit(1);
  }
}

main();
