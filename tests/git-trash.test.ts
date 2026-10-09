import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { clean, discard, undo, list } from "../src/core.js";
import { isGitRepo, getUntrackedFiles, getModifiedFiles } from "../src/git.js";
import { loadJournal } from "../src/journal.js";

describe("git-trash tests", () => {
  let testRepoDir: string;

  beforeEach(() => {
    // Create isolated test git repo
    testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-trash-test-"));
    spawnSync("git", ["init"], { cwd: testRepoDir });
    spawnSync("git", ["config", "user.name", "Test User"], { cwd: testRepoDir });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: testRepoDir });

    // Initial commit
    fs.writeFileSync(path.join(testRepoDir, "initial.txt"), "committed content\n", "utf8");
    spawnSync("git", ["add", "."], { cwd: testRepoDir });
    spawnSync("git", ["commit", "-m", "initial commit"], { cwd: testRepoDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(testRepoDir, { recursive: true, force: true });
    } catch {}
  });

  it("detects git repo correctly", () => {
    expect(isGitRepo(testRepoDir)).toBe(true);
    expect(isGitRepo(os.tmpdir())).toBe(false);
  });

  it("dry-run does not delete or move files", async () => {
    const untrackedFile = path.join(testRepoDir, "temp file with spaces.txt");
    fs.writeFileSync(untrackedFile, "secret draft\n", "utf8");

    const result = await clean({
      dryRun: true,
      cwd: testRepoDir,
      silent: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.trashedFiles.length).toBe(1);
    expect(result.trashedFiles[0].relativePath).toBe("temp file with spaces.txt");
    expect(fs.existsSync(untrackedFile)).toBe(true);
  });

  it("safely cleans untracked files and restores them with undo", async () => {
    const file1 = path.join(testRepoDir, "new-component.tsx");
    const file2 = path.join(testRepoDir, "scratch-note.md");
    fs.writeFileSync(file1, "export const App = () => <div>Hello</div>;", "utf8");
    fs.writeFileSync(file2, "# My Scratch Note", "utf8");

    expect(fs.existsSync(file1)).toBe(true);
    expect(fs.existsSync(file2)).toBe(true);

    // Clean untracked files
    const cleanResult = await clean({
      cwd: testRepoDir,
      silent: true,
    });

    expect(cleanResult.trashedFiles.length).toBe(2);
    expect(fs.existsSync(file1)).toBe(false);
    expect(fs.existsSync(file2)).toBe(false);

    // Journal should have the session
    const journal = loadJournal(testRepoDir);
    expect(journal.sessions.length).toBe(1);
    expect(journal.sessions[0].command).toBe("clean");

    // Call undo
    const undoResult = undo(testRepoDir, true);
    expect(undoResult.restoredCount).toBe(2);

    // Both files must be back with identical content!
    expect(fs.existsSync(file1)).toBe(true);
    expect(fs.existsSync(file2)).toBe(true);
    expect(fs.readFileSync(file1, "utf8")).toBe("export const App = () => <div>Hello</div>;");
    expect(fs.readFileSync(file2, "utf8")).toBe("# My Scratch Note");
  });

  it("safely discards modified tracked files and can undo back to edited state", async () => {
    const trackedFile = path.join(testRepoDir, "initial.txt");
    // Modify tracked file
    fs.writeFileSync(trackedFile, "dirty uncommitted changes\n", "utf8");

    const modified = getModifiedFiles(testRepoDir);
    expect(modified.length).toBe(1);
    expect(modified[0].relativePath).toBe("initial.txt");

    // Discard modifications
    const discardResult = await discard(["initial.txt"], {
      cwd: testRepoDir,
      silent: true,
    });

    expect(discardResult.discardedFiles.length).toBe(1);
    // Git restore reverted file to committed state
    expect(fs.readFileSync(trackedFile, "utf8").trim()).toBe("committed content");

    // Undo the discard!
    const undoResult = undo(testRepoDir, true);
    expect(undoResult.restoredCount).toBe(1);

    // Modified changes are restored!
    expect(fs.readFileSync(trackedFile, "utf8").trim()).toBe("dirty uncommitted changes");
  });

  it("handles ignored files with --include-ignored flag", async () => {
    fs.writeFileSync(path.join(testRepoDir, ".gitignore"), "*.log\n", "utf8");
    spawnSync("git", ["add", ".gitignore"], { cwd: testRepoDir });
    spawnSync("git", ["commit", "-m", "add gitignore"], { cwd: testRepoDir });

    const logFile = path.join(testRepoDir, "debug.log");
    fs.writeFileSync(logFile, "error logs\n", "utf8");

    // By default, ignored files are not touched
    const untrackedDefault = getUntrackedFiles({ cwd: testRepoDir });
    expect(untrackedDefault.length).toBe(0);

    // With includeIgnored: true, it finds the ignored log
    const untrackedIgnored = getUntrackedFiles({ includeIgnored: true, cwd: testRepoDir });
    expect(untrackedIgnored.length).toBe(1);
    expect(untrackedIgnored[0].relativePath).toBe("debug.log");
    expect(untrackedIgnored[0].isIgnored).toBe(true);
  });

  it("handles deep nested subdirectories with untracked files", async () => {
    const deepDir = path.join(testRepoDir, "src", "nested", "module");
    fs.mkdirSync(deepDir, { recursive: true });
    const deepFile = path.join(deepDir, "helper.ts");
    fs.writeFileSync(deepFile, "export const helper = true;", "utf8");

    const cleanResult = await clean({
      cwd: testRepoDir,
      silent: true,
    });

    expect(cleanResult.trashedFiles.length).toBe(1);
    expect(fs.existsSync(deepFile)).toBe(false);

    // Undo should recreate directory structure and restore file
    const undoResult = undo(testRepoDir, true);
    expect(undoResult.restoredCount).toBe(1);
    expect(fs.existsSync(deepFile)).toBe(true);
    expect(fs.readFileSync(deepFile, "utf8")).toBe("export const helper = true;");
  });

  it("handles multiple consecutive sessions in LIFO order", async () => {
    // Session 1: file A
    const fileA = path.join(testRepoDir, "batchA.txt");
    fs.writeFileSync(fileA, "content A", "utf8");
    await clean({ cwd: testRepoDir, silent: true });

    // Session 2: file B
    const fileB = path.join(testRepoDir, "batchB.txt");
    fs.writeFileSync(fileB, "content B", "utf8");
    await clean({ cwd: testRepoDir, silent: true });

    expect(fs.existsSync(fileA)).toBe(false);
    expect(fs.existsSync(fileB)).toBe(false);

    // First undo restores file B
    const undo1 = undo(testRepoDir, true);
    expect(undo1.restoredCount).toBe(1);
    expect(fs.existsSync(fileB)).toBe(true);
    expect(fs.existsSync(fileA)).toBe(false);

    // Second undo restores file A
    const undo2 = undo(testRepoDir, true);
    expect(undo2.restoredCount).toBe(1);
    expect(fs.existsSync(fileA)).toBe(true);
  });
});
