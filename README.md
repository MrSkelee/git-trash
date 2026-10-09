# git-trash 🗑️

> **The OS Recycle Bin for Git.** Safely move untracked and discarded files to your system Trash instead of permanent hard-deletion.

[![npm version](https://img.shields.io/npm/v/git-trash.svg?color=blue)](https://www.npmjs.com/package/git-trash)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

For 20 years, Git commands like `git clean -fd` and `git restore .` have operated using low-level OS `unlink()`. When you accidentally run them, your uncommitted code, new components, and scratch drafts are **permanently obliterated from disk**. They do not go to the Windows Recycle Bin, they do not go to the macOS Trash, and they are not stored in `git reflog`.

**`git-trash` fixes this forever.**

---

## ⚡ Key Features

- ♻️ **Native OS Recycle Bin Integration:** Moves untracked files to your system Trash (Windows Cestino, macOS Trash, Linux FreeDesktop Trash).
- ⏪ **Instant CLI Undo:** Made a mistake? Run `git trash undo` to instantly restore files back to their exact original locations.
- 🛡️ **Double-Layer Safety Net:**
  1. **OS Level:** View and recover files from your desktop Recycle Bin UI.
  2. **Git Journal Level:** Local `.git/trash/` journal for one-command terminal undo.
- 🎯 **Safe Discard:** `git trash discard [files]` snapshots your uncommitted modifications before reverting, so accidental reverts can be reversed.
- 🔌 **Drop-in Git Subcommand:** Once installed, Git automatically invokes it via `git trash`.
- 🔍 **Interactive Dry Run:** Preview everything with `git trash -n` before touching disk.

---

## 📦 Quick Setup

Enable `git trash` as a native Git subcommand on your machine:

```bash
git config --global alias.trash "!npx git-trash"
```

Once configured, simply use `git trash` anywhere:

```bash
git trash               # Safe clean untracked files
git trash -n            # Dry run preview
git trash discard .     # Safe discard modifications
git trash undo          # Instant restore
```

Or run directly via npx without configuring:

```bash
npx git-trash
```

---

## 🚀 Usage

### 1. Safe Clean (Replace `git clean -fd`)

Moves all untracked files to the OS Recycle Bin:

```bash
git trash
# or
git trash clean
```

Preview what would be trashed without moving anything:

```bash
git trash -n
# or
git trash --dry-run
```

Also trash files ignored by `.gitignore`:

```bash
git trash -x
```

### 2. Instant Undo (Restore Last Trashed Batch)

Accidentally cleaned files you still needed? Restore them instantly:

```bash
git trash undo
```

All files and nested directory structures are immediately recreated in your working tree.

### 3. Safe Discard (Replace `git restore .`)

Discards uncommitted changes to tracked files, but creates a safety snapshot first:

```bash
# Discard all working tree changes safely
git trash discard .

# Or discard specific files
git trash discard src/index.ts
```

If you realize you discarded code you still needed, just run:

```bash
git trash undo
```

### 4. View Trash History

Inspect previous trash sessions and affected files:

```bash
git trash list
```

---

## 🛡️ How It Works

```
┌─────────────────┐       git trash clean       ┌────────────────────────┐
│  Untracked      │ ──────────────────────────> │   OS Recycle Bin /     │
│  Files on Disk  │                             │   Trash (Win/Mac/Linux)│
└─────────────────┘                             └────────────────────────┘
         │                                                   │
         │ Snapshot metadata                                 │ Manual GUI
         ▼                                                   │ recovery
┌─────────────────┐       git trash undo                     ▼
│ .git/trash/     │ ──────────────────────────> ┌────────────────────────┐
│ Safety Journal  │                             │ Working Tree Restored  │
└─────────────────┘                             └────────────────────────┘
```

1. **Before any file is touched**, `git-trash` creates an isolated backup snapshot in `.git/trash/snapshots/<session-id>/`.
2. It sends the original file to your **OS Recycle Bin** using native system APIs.
3. If you run `git trash undo`, the journal immediately restores the exact files and directories.

---

## 📄 License

MIT © [MrSkele](https://github.com/MrSkelee)

---

<p align="center">
  <sub>Vibe Coded with 💖 by MrSkele & Antigravity</sub>
</p>

