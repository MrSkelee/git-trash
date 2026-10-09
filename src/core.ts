import fs from "node:fs";
import path from "node:path";
import trash from "trash";
import pc from "picocolors";
import {
  isGitRepo,
  getRepoRoot,
  getUntrackedFiles,
  getModifiedFiles,
  restoreGitFiles,
  UntrackedFile,
  ModifiedFile,
} from "./git.js";
import {
  createTrashSession,
  undoLastSession,
  getHistory,
  TrashSession,
} from "./journal.js";

export interface CleanOptions {
  dryRun?: boolean;
  includeIgnored?: boolean;
  cwd?: string;
  silent?: boolean;
}

export interface DiscardOptions {
  dryRun?: boolean;
  cwd?: string;
  silent?: boolean;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * git trash clean:
 * Moves untracked files safely to the OS Recycle Bin instead of deleting them.
 */
export async function clean(options: CleanOptions = {}): Promise<{
  trashedFiles: UntrackedFile[];
  dryRun: boolean;
  sessionId?: string;
}> {
  const cwd = options.cwd || process.cwd();

  if (!isGitRepo(cwd)) {
    throw new Error("Not inside a git repository. git-trash requires a Git working tree.");
  }

  const files = getUntrackedFiles({
    includeIgnored: options.includeIgnored,
    cwd,
  });

  if (files.length === 0) {
    if (!options.silent) {
      console.log(pc.green("✔ Nothing to clean. Working tree is clean."));
    }
    return { trashedFiles: [], dryRun: !!options.dryRun };
  }

  if (options.dryRun) {
    if (!options.silent) {
      console.log(pc.cyan(`\n🔍 [Dry Run] The following ${files.length} untracked item(s) would be moved to the OS Trash:\n`));
      for (const file of files) {
        let sizeStr = "";
        try {
          if (fs.existsSync(file.absolutePath)) {
            const stat = fs.statSync(file.absolutePath);
            sizeStr = pc.dim(` (${formatBytes(stat.size)})`);
          }
        } catch {}
        const tag = file.isIgnored ? pc.yellow("[ignored] ") : "";
        console.log(`  ${pc.red("✖")} ${tag}${file.relativePath}${sizeStr}`);
      }
      console.log(pc.dim("\nNo files were moved. Run without --dry-run to move them to Trash."));
    }
    return { trashedFiles: files, dryRun: true };
  }

  // 1. Create a safety snapshot in .git/trash journal
  const session = createTrashSession("clean", files, cwd);

  // 2. Move files to OS Recycle Bin using native OS APIs
  const absPaths = files.map((f) => f.absolutePath);
  await trash(absPaths, { glob: false });

  if (!options.silent) {
    console.log(pc.green(`\n✔ Safely moved ${pc.bold(files.length.toString())} untracked file(s) to your OS Recycle Bin / Trash:`));
    for (const file of files) {
      const tag = file.isIgnored ? pc.yellow("[ignored] ") : "";
      console.log(`  ${pc.gray("↳")} ${tag}${file.relativePath}`);
    }
    console.log(pc.cyan(`\n💡 Mistake? Restore them instantly with:`));
    console.log(`   ${pc.bold("git trash undo")}\n`);
  }

  return { trashedFiles: files, dryRun: false, sessionId: session.id };
}

/**
 * git trash discard [files...]:
 * Replaces dangerous 'git restore' by snapshotting modified tracked files before reverting them.
 */
export async function discard(
  targets: string[] = [],
  options: DiscardOptions = {}
): Promise<{
  discardedFiles: ModifiedFile[];
  dryRun: boolean;
  sessionId?: string;
}> {
  const cwd = options.cwd || process.cwd();

  if (!isGitRepo(cwd)) {
    throw new Error("Not inside a git repository. git-trash requires a Git working tree.");
  }

  const allModified = getModifiedFiles(cwd);
  if (allModified.length === 0) {
    if (!options.silent) {
      console.log(pc.green("✔ No modified tracked files to discard."));
    }
    return { discardedFiles: [], dryRun: !!options.dryRun };
  }

  // Filter modified files based on targets (if any specified)
  let filesToDiscard: ModifiedFile[] = [];
  if (targets.length === 0 || targets.includes(".")) {
    filesToDiscard = allModified;
  } else {
    const normalizedTargets = targets.map((t) => path.normalize(t));
    filesToDiscard = allModified.filter((m) =>
      normalizedTargets.some((t) => m.relativePath === t || m.relativePath.startsWith(t + path.sep))
    );
  }

  if (filesToDiscard.length === 0) {
    if (!options.silent) {
      console.log(pc.yellow("No modified files matched the specified paths."));
    }
    return { discardedFiles: [], dryRun: !!options.dryRun };
  }

  if (options.dryRun) {
    if (!options.silent) {
      console.log(pc.cyan(`\n🔍 [Dry Run] The following ${filesToDiscard.length} modified file(s) would be safely reverted:\n`));
      for (const file of filesToDiscard) {
        console.log(`  ${pc.yellow("~")} ${file.relativePath} (${file.status})`);
      }
      console.log(pc.dim("\nNo modifications were discarded."));
    }
    return { discardedFiles: filesToDiscard, dryRun: true };
  }

  // 1. Snapshot modifications into journal before restoring
  const snapshotItems = filesToDiscard.map((f) => ({
    relativePath: f.relativePath,
    absolutePath: f.absolutePath,
    isModifiedTracked: true,
  }));
  const session = createTrashSession("discard", snapshotItems, cwd);

  // 2. Revert files via git restore
  const relPaths = filesToDiscard.map((f) => f.relativePath);
  restoreGitFiles(relPaths, cwd);

  if (!options.silent) {
    console.log(pc.green(`\n✔ Safely discarded unstaged changes in ${pc.bold(filesToDiscard.length.toString())} file(s):`));
    for (const file of filesToDiscard) {
      console.log(`  ${pc.gray("↳")} ${file.relativePath}`);
    }
    console.log(pc.cyan(`\n💡 Modifications were snapshotted before revert. Undo anytime with:`));
    console.log(`   ${pc.bold("git trash undo")}\n`);
  }

  return { discardedFiles: filesToDiscard, dryRun: false, sessionId: session.id };
}

/**
 * git trash undo:
 * Instantly restores the last trashed or discarded batch back to the working tree.
 */
export function undo(cwd: string = process.cwd(), silent: boolean = false): {
  restoredCount: number;
  session?: TrashSession;
} {
  if (!isGitRepo(cwd)) {
    throw new Error("Not inside a git repository. git-trash requires a Git working tree.");
  }

  const result = undoLastSession(cwd);
  if (!result) {
    if (!silent) {
      console.log(pc.yellow("No previous git-trash sessions found to undo in this repository."));
    }
    return { restoredCount: 0 };
  }

  if (!silent) {
    console.log(pc.green(`\n✔ Successfully restored ${pc.bold(result.restoredCount.toString())} file(s) from session [${result.session.id}]:`));
    for (const item of result.session.items) {
      console.log(`  ${pc.green("✔")} ${item.relativePath}`);
    }
    console.log("");
  }

  return result;
}

/**
 * git trash list:
 * Lists previous trash sessions.
 */
export function list(cwd: string = process.cwd()): TrashSession[] {
  if (!isGitRepo(cwd)) {
    throw new Error("Not inside a git repository. git-trash requires a Git working tree.");
  }

  const history = getHistory(cwd);
  if (history.length === 0) {
    console.log(pc.dim("No trash history in this repository."));
    return [];
  }

  console.log(pc.cyan(`\n📦 Git-Trash History (${history.length} session(s)):\n`));
  for (const session of history) {
    const timeStr = new Date(session.timestamp).toLocaleString();
    console.log(`${pc.bold(session.id)} — ${pc.yellow(session.command.toUpperCase())} at ${timeStr}`);
    console.log(`  Items (${session.items.length}):`);
    for (const item of session.items.slice(0, 5)) {
      console.log(`    - ${item.relativePath}`);
    }
    if (session.items.length > 5) {
      console.log(pc.dim(`    ... and ${session.items.length - 5} more`));
    }
    console.log("");
  }

  return history;
}
