import fs from "node:fs";
import path from "node:path";
import { getGitDir, getRepoRoot } from "./git.js";

export interface TrashedItem {
  relativePath: string;
  absolutePath: string;
  size: number;
  isIgnored?: boolean;
  isModifiedTracked?: boolean;
  backupFile: string;
}

export interface TrashSession {
  id: string;
  timestamp: string;
  command: "clean" | "discard";
  repoRoot: string;
  items: TrashedItem[];
}

export interface TrashJournal {
  version: 1;
  sessions: TrashSession[];
}

function getTrashStorageDir(cwd: string = process.cwd()): string {
  const gitDir = getGitDir(cwd);
  const trashDir = path.join(gitDir, "trash");
  if (!fs.existsSync(trashDir)) {
    fs.mkdirSync(trashDir, { recursive: true });
  }
  return trashDir;
}

function getJournalFilePath(cwd: string = process.cwd()): string {
  return path.join(getTrashStorageDir(cwd), "journal.json");
}

export function loadJournal(cwd: string = process.cwd()): TrashJournal {
  const file = getJournalFilePath(cwd);
  if (!fs.existsSync(file)) {
    return { version: 1, sessions: [] };
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return { version: 1, sessions: [] };
  }
}

export function saveJournal(journal: TrashJournal, cwd: string = process.cwd()): void {
  const file = getJournalFilePath(cwd);
  fs.writeFileSync(file, JSON.stringify(journal, null, 2), "utf8");
}

/**
 * Creates a backup snapshot for a batch of files before they are trashed/discarded.
 */
export function createTrashSession(
  command: "clean" | "discard",
  files: Array<{
    relativePath: string;
    absolutePath: string;
    isIgnored?: boolean;
    isModifiedTracked?: boolean;
  }>,
  cwd: string = process.cwd()
): TrashSession {
  const trashDir = getTrashStorageDir(cwd);
  const repoRoot = getRepoRoot(cwd);
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const snapshotDir = path.join(trashDir, "snapshots", sessionId);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const items: TrashedItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let size = 0;
    const backupFile = path.join(snapshotDir, `file_${i}_${path.basename(file.relativePath)}`);

    try {
      if (fs.existsSync(file.absolutePath)) {
        const stat = fs.statSync(file.absolutePath);
        if (stat.isFile()) {
          size = stat.size;
          fs.copyFileSync(file.absolutePath, backupFile);
        } else if (stat.isDirectory()) {
          // In case a whole untracked folder is targeted
          fs.cpSync(file.absolutePath, backupFile, { recursive: true });
        }
      }
    } catch (err) {
      // Continue even if a single file snapshot fails
    }

    items.push({
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      size,
      isIgnored: file.isIgnored,
      isModifiedTracked: file.isModifiedTracked,
      backupFile,
    });
  }

  const session: TrashSession = {
    id: sessionId,
    timestamp: new Date().toISOString(),
    command,
    repoRoot,
    items,
  };

  const journal = loadJournal(cwd);
  journal.sessions.push(session);
  saveJournal(journal, cwd);

  return session;
}

/**
 * Undoes the most recent session, restoring files to original paths.
 */
export function undoLastSession(cwd: string = process.cwd()): {
  session: TrashSession;
  restoredCount: number;
} | null {
  const journal = loadJournal(cwd);
  if (journal.sessions.length === 0) {
    return null;
  }

  const session = journal.sessions.pop()!;
  let restoredCount = 0;

  for (const item of session.items) {
    if (fs.existsSync(item.backupFile)) {
      const parent = path.dirname(item.absolutePath);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }

      const stat = fs.statSync(item.backupFile);
      if (stat.isDirectory()) {
        fs.cpSync(item.backupFile, item.absolutePath, { recursive: true });
      } else {
        fs.copyFileSync(item.backupFile, item.absolutePath);
      }
      restoredCount++;
    }
  }

  // Clean up snapshot folder
  const trashDir = getTrashStorageDir(cwd);
  const snapshotDir = path.join(trashDir, "snapshots", session.id);
  try {
    if (fs.existsSync(snapshotDir)) {
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }

  saveJournal(journal, cwd);

  return { session, restoredCount };
}

/**
 * Gets all recorded trash sessions.
 */
export function getHistory(cwd: string = process.cwd()): TrashSession[] {
  const journal = loadJournal(cwd);
  return [...journal.sessions].reverse();
}
