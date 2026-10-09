import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { clean, discard, undo } from "../src/core.js";
import { loadJournal } from "../src/journal.js";

describe("Real-World Edge Cases Stress Test", () => {
  let testRepoDir: string;

  beforeEach(() => {
    testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-trash-edge-"));
    spawnSync("git", ["init"], { cwd: testRepoDir });
    spawnSync("git", ["config", "user.name", "Test User"], { cwd: testRepoDir });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: testRepoDir });

    fs.writeFileSync(path.join(testRepoDir, "readme.md"), "# Initial\n", "utf8");
    spawnSync("git", ["add", "."], { cwd: testRepoDir });
    spawnSync("git", ["commit", "-m", "init"], { cwd: testRepoDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(testRepoDir, { recursive: true, force: true });
    } catch {}
  });

  // CASO 1: File con caratteri speciali estremi (parentesi quadre, apici, percentuali, spazi multipli, simboli)
  it("Caso 1: Gestione file con parentesi quadre, simboli glob e spazi multipli", async () => {
    const weirdName = "[draft] test (final) v2 #1 @temp & cool [100%].tsx";
    const filePath = path.join(testRepoDir, weirdName);
    fs.writeFileSync(filePath, "export const Special = true;\n", "utf8");

    expect(fs.existsSync(filePath)).toBe(true);

    // Clean deve gestire le parentesi quadre senza interpretarle come glob
    const cleanResult = await clean({ cwd: testRepoDir, silent: true });
    expect(cleanResult.trashedFiles.length).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);

    // Undo deve ripristinare il file col nome esatto
    const undoResult = undo(testRepoDir, true);
    expect(undoResult.restoredCount).toBe(1);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("export const Special = true;\n");
  });

  // CASO 2: File in sola lettura (Read-Only)
  it("Caso 2: Gestione file marcati con permessi di sola lettura (Read-Only)", async () => {
    const roFile = path.join(testRepoDir, "locked-readonly-file.env");
    fs.writeFileSync(roFile, "SECRET_KEY=12345\n", "utf8");

    // Imposta permessi sola lettura (0444 su POSIX, su Windows tenta chmod)
    try {
      fs.chmodSync(roFile, 0o444);
    } catch {}

    const cleanResult = await clean({ cwd: testRepoDir, silent: true });
    expect(cleanResult.trashedFiles.length).toBe(1);
    expect(fs.existsSync(roFile)).toBe(false);

    const undoResult = undo(testRepoDir, true);
    expect(undoResult.restoredCount).toBe(1);
    expect(fs.existsSync(roFile)).toBe(true);
    expect(fs.readFileSync(roFile, "utf8")).toBe("SECRET_KEY=12345\n");
  });

  // CASO 3: Collisione durante 'git trash undo' (un nuovo file è stato creato mentre l'altro era nel cestino)
  it("Caso 3: Collisione su undo — se esiste già un file diverso, non distrugge il lavoro nuovo", async () => {
    const targetFile = path.join(testRepoDir, "service.ts");
    fs.writeFileSync(targetFile, "ORIGINAL OLD CODE\n", "utf8");

    // Sposta nel cestino
    await clean({ cwd: testRepoDir, silent: true });
    expect(fs.existsSync(targetFile)).toBe(false);

    // Nel frattempo viene creato un NUOVO file con codice nuovo diverso
    fs.writeFileSync(targetFile, "BRAND NEW FRESH CODE\n", "utf8");

    // Quando facciamo undo, cosa succede?
    const undoResult = undo(testRepoDir, true);

    // Il file nuovo NON è stato cancellato!
    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, "utf8")).toBe("BRAND NEW FRESH CODE\n");

    // E il file vecchio è stato ripristinato in sicurezza come service.restored.ts
    const restoredCollisionFile = path.join(testRepoDir, "service.restored.ts");
    expect(fs.existsSync(restoredCollisionFile)).toBe(true);
    expect(fs.readFileSync(restoredCollisionFile, "utf8")).toBe("ORIGINAL OLD CODE\n");

    expect(undoResult.collisions?.length).toBe(1);
    expect(undoResult.collisions?.[0].originalPath).toBe("service.ts");
  });
});
