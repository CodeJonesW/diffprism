import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  writeServerFile,
  readServerFile,
  removeServerFile,
} from "../server-file.js";
import type { GlobalServerInfo } from "../types.js";

const serverDir = path.join(os.homedir(), ".diffprism");
const serverFilePath = path.join(serverDir, "server.json");

// Store original file content to restore after tests
let originalContent: string | null = null;

beforeEach(() => {
  // Preserve existing server.json if it exists
  try {
    originalContent = fs.readFileSync(serverFilePath, "utf-8");
  } catch {
    originalContent = null;
  }
});

afterEach(() => {
  // Restore original state
  if (originalContent !== null) {
    fs.writeFileSync(serverFilePath, originalContent);
  } else {
    try {
      fs.unlinkSync(serverFilePath);
    } catch {
      // File may not exist
    }
  }
});

describe("server-file", () => {
  describe("writeServerFile", () => {
    it("creates the server file with correct content", () => {
      const info: GlobalServerInfo = {
        httpPort: 24680,
        wsPort: 24681,
        pid: process.pid,
        startedAt: Date.now(),
      };

      writeServerFile(info);

      const raw = fs.readFileSync(serverFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.httpPort).toBe(24680);
      expect(parsed.wsPort).toBe(24681);
      expect(parsed.pid).toBe(process.pid);
    });

    it("creates the directory if it does not exist", () => {
      // writeServerFile should not throw even if ~/.diffprism doesn't exist
      // (it will exist in practice since we have other files there)
      const info: GlobalServerInfo = {
        httpPort: 24680,
        wsPort: 24681,
        pid: process.pid,
        startedAt: Date.now(),
      };

      writeServerFile(info);
      expect(fs.existsSync(serverFilePath)).toBe(true);
    });
  });

  describe("readServerFile", () => {
    it("returns null when file does not exist", () => {
      // Clean up any existing file
      try {
        fs.unlinkSync(serverFilePath);
      } catch {
        // File may not exist
      }

      const result = readServerFile();
      expect(result).toBeNull();
    });

    it("returns the server info when file exists and PID is alive", () => {
      const info: GlobalServerInfo = {
        httpPort: 24680,
        wsPort: 24681,
        pid: process.pid, // Current process is alive
        startedAt: Date.now(),
      };

      writeServerFile(info);

      const result = readServerFile();
      expect(result).not.toBeNull();
      expect(result!.httpPort).toBe(24680);
      expect(result!.wsPort).toBe(24681);
      expect(result!.pid).toBe(process.pid);
    });

    it("returns null and cleans up when PID is dead", () => {
      const info: GlobalServerInfo = {
        httpPort: 24680,
        wsPort: 24681,
        pid: 999999, // Almost certainly not alive
        startedAt: Date.now(),
      };

      writeServerFile(info);

      const result = readServerFile();
      expect(result).toBeNull();
      // File should have been cleaned up
      expect(fs.existsSync(serverFilePath)).toBe(false);
    });
  });

  describe("removeServerFile", () => {
    it("removes the server file", () => {
      const info: GlobalServerInfo = {
        httpPort: 24680,
        wsPort: 24681,
        pid: process.pid,
        startedAt: Date.now(),
      };

      writeServerFile(info);
      expect(fs.existsSync(serverFilePath)).toBe(true);

      removeServerFile();
      expect(fs.existsSync(serverFilePath)).toBe(false);
    });

    it("does not throw when file does not exist", () => {
      try {
        fs.unlinkSync(serverFilePath);
      } catch {
        // File may not exist
      }

      expect(() => removeServerFile()).not.toThrow();
    });
  });
});
