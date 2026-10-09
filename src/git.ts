import { spawnSync } from "node:child_process";
import path from "node:path";

export interface UntrackedFile {
  relativePath: string;
  absolutePath: string;
  isIgnored: boolean;
}

export interface ModifiedFile {
  relativePath: string;
  absolutePath: string;
  status: string;
}

export function isGitRepo(cwd: string = process.cwd()): boolean {
  try {
    const res = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return res.status === 0 && res.stdout.trim() === "true";
  } catch {
    return false;
  }
}

export function getRepoRoot(cwd: string = process.cwd()): string {
  try {
    const res = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.status !== 0) {
      throw new Error(res.stderr.trim() || "Not inside a git repository");
    }
    return path.resolve(res.stdout.trim());
  } catch (err: any) {
    throw new Error(`Git error: ${err.message || String(err)}`);
  }
}

export function getGitDir(cwd: string = process.cwd()): string {
  try {
    const res = spawnSync("git", ["rev-parse", "--git-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.status !== 0) {
      throw new Error(res.stderr.trim() || "Not inside a git repository");
    }
    const gitDir = res.stdout.trim();
    return path.isAbsolute(gitDir) ? gitDir : path.resolve(cwd, gitDir);
  } catch (err: any) {
    throw new Error(`Git error: ${err.message || String(err)}`);
  }
}

/**
 * Returns all untracked files in the repository.
 * Uses NUL-separated (-z) output to safely handle any spaces, quotes, or special characters.
 */
export function getUntrackedFiles(options: {
  includeIgnored?: boolean;
  cwd?: string;
} = {}): UntrackedFile[] {
  const cwd = options.cwd || process.cwd();
  const repoRoot = getRepoRoot(cwd);

  const args = ["status", "--porcelain=v1", "-z", "-uall"];
  if (options.includeIgnored) {
    args.push("--ignored");
  }

  const res = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.status !== 0) {
    throw new Error(`git status failed: ${res.stderr.trim()}`);
  }

  const output = res.stdout;
  if (!output) {
    return [];
  }

  const items = output.split("\0").filter(Boolean);
  const results: UntrackedFile[] = [];

  for (const item of items) {
    if (item.length < 3) continue;
    const prefix = item.slice(0, 2);
    const relPath = item.slice(3);

    const isUntracked = prefix === "??" || prefix === "? ";
    const isIgnored = prefix === "!!" || prefix === "! ";

    if (isUntracked || (options.includeIgnored && isIgnored)) {
      const absPath = path.resolve(repoRoot, relPath);
      results.push({
        relativePath: relPath,
        absolutePath: absPath,
        isIgnored,
      });
    }
  }

  return results;
}

/**
 * Returns tracked modified files in the working tree.
 */
export function getModifiedFiles(cwd: string = process.cwd()): ModifiedFile[] {
  const repoRoot = getRepoRoot(cwd);
  const res = spawnSync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.status !== 0) {
    throw new Error(`git status failed: ${res.stderr.trim()}`);
  }

  const output = res.stdout;
  if (!output) return [];

  const items = output.split("\0").filter(Boolean);
  const results: ModifiedFile[] = [];

  for (const item of items) {
    if (item.length < 3) continue;
    const code = item.slice(0, 2);
    const relPath = item.slice(3);

    // Skip untracked and ignored
    if (code.startsWith("?") || code.startsWith("!")) continue;

    const absPath = path.resolve(repoRoot, relPath);
    results.push({
      relativePath: relPath,
      absolutePath: absPath,
      status: code.trim(),
    });
  }

  return results;
}

/**
 * Runs `git restore` on given files or pathspecs.
 */
export function restoreGitFiles(files: string[], cwd: string = process.cwd()): void {
  const repoRoot = getRepoRoot(cwd);
  if (files.length === 0) return;

  const res = spawnSync("git", ["restore", "--staged", "--worktree", "--", ...files], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.status !== 0) {
    // Fallback to legacy git checkout if git restore is unavailable on older git versions
    const fallback = spawnSync("git", ["checkout", "HEAD", "--", ...files], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (fallback.status !== 0) {
      throw new Error(`Failed to restore files: ${res.stderr || fallback.stderr}`);
    }
  }
}
