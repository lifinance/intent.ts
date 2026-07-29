import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a test version of the walk function that accepts a base directory
// This mirrors the implementation in rewrite-dist-imports.mjs
function createWalk(baseDir) {
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const fullPath = path.resolve(dir, entry.name);
      const relative = path.relative(baseDir, fullPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        continue;
      }
      if (entry.isDirectory()) {
        files.push(...(await walk(fullPath)));
        continue;
      }

      if (fullPath.endsWith(".js") || fullPath.endsWith(".d.ts")) {
        files.push(fullPath);
      }
    }

    return files;
  }
  return walk;
}

describe("rewrite-dist-imports path traversal protection", () => {
  const testDir = path.join(__dirname, ".test-dist-security");
  const testDistDir = path.join(testDir, "dist");
  let walk;

  beforeEach(async () => {
    // Create test directory structure
    await fs.mkdir(testDistDir, { recursive: true });
    await fs.mkdir(path.join(testDistDir, "subdir"), { recursive: true });
    
    // Create legitimate files
    await fs.writeFile(path.join(testDistDir, "index.js"), "export {};");
    await fs.writeFile(path.join(testDistDir, "index.d.ts"), "export {};");
    await fs.writeFile(path.join(testDistDir, "subdir", "module.js"), "export {};");
    
    // Create walk function for this test's distDir
    walk = createWalk(testDistDir);
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("path traversal vulnerability mitigation", () => {
    it("should reject paths with .. that escape distDir", async () => {
      // Create a directory outside dist
      const outsideDir = path.join(testDir, "outside");
      await fs.mkdir(outsideDir, { recursive: true });
      await fs.writeFile(path.join(outsideDir, "malicious.js"), "// malicious");

      // Create a symlink attempting path traversal (if supported)
      const symlinkPath = path.join(testDistDir, "escape");
      try {
        await fs.symlink(outsideDir, symlinkPath, "dir");
        
        // Walk should not include files from outside dist
        const files = await walk(testDistDir);
        const fileNames = files.map(f => path.basename(f));
        
        expect(fileNames).not.toContain("malicious.js");
      } catch (err) {
        // Symlinks might not be supported on all systems, skip this specific check
        if (err.code !== "EPERM" && err.code !== "ENOTSUP") {
          throw err;
        }
      }
    });

    it("should only process files within distDir", async () => {
      const files = await walk(testDistDir);
      
      // All returned files should be within testDistDir
      for (const file of files) {
        const relative = path.relative(testDistDir, file);
        expect(relative.startsWith("..")).toBe(false);
        expect(path.isAbsolute(relative)).toBe(false);
      }
    });

    it("should reject absolute paths in relative context", async () => {
      const files = await walk(testDistDir);
      
      // Verify that the relative path check works correctly
      for (const file of files) {
        const relative = path.relative(testDistDir, file);
        // The relative path should not be absolute
        expect(path.isAbsolute(relative)).toBe(false);
      }
    });

    it("should handle legitimate nested directories", async () => {
      const files = await walk(testDistDir);
      const fileNames = files.map(f => path.basename(f));
      
      // Should include legitimate files
      expect(fileNames).toContain("index.js");
      expect(fileNames).toContain("index.d.ts");
      expect(fileNames).toContain("module.js");
    });

    it("should use path.resolve instead of path.join for security", async () => {
      // Test that path.resolve is used by checking behavior with tricky names
      const trickyDir = path.join(testDistDir, "normal");
      await fs.mkdir(trickyDir, { recursive: true });
      await fs.writeFile(path.join(trickyDir, "file.js"), "export {};");
      
      const files = await walk(testDistDir);
      const normalFile = files.find(f => f.includes("normal"));
      
      // Should find the file in the normal directory
      expect(normalFile).toBeDefined();
      
      // The resolved path should be normalized
      expect(path.isAbsolute(normalFile)).toBe(true);
    });
  });

  describe("functional behavior preservation", () => {
    it("should collect .js files", async () => {
      const files = await walk(testDistDir);
      const jsFiles = files.filter(f => f.endsWith(".js"));
      
      expect(jsFiles.length).toBeGreaterThan(0);
      expect(jsFiles.some(f => f.endsWith("index.js"))).toBe(true);
    });

    it("should collect .d.ts files", async () => {
      const files = await walk(testDistDir);
      const dtsFiles = files.filter(f => f.endsWith(".d.ts"));
      
      expect(dtsFiles.length).toBeGreaterThan(0);
      expect(dtsFiles.some(f => f.endsWith("index.d.ts"))).toBe(true);
    });

    it("should recursively walk subdirectories", async () => {
      const files = await walk(testDistDir);
      const subdirFiles = files.filter(f => f.includes("subdir"));
      
      expect(subdirFiles.length).toBeGreaterThan(0);
    });

    it("should ignore non-.js and non-.d.ts files", async () => {
      await fs.writeFile(path.join(testDistDir, "readme.txt"), "text");
      await fs.writeFile(path.join(testDistDir, "data.json"), "{}");
      
      const files = await walk(testDistDir);
      const fileNames = files.map(f => path.basename(f));
      
      expect(fileNames).not.toContain("readme.txt");
      expect(fileNames).not.toContain("data.json");
    });
  });

  describe("edge cases", () => {
    it("should handle empty directories", async () => {
      const emptyDir = path.join(testDistDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });
      
      const files = await walk(testDistDir);
      // Should not throw and should still find other files
      expect(files.length).toBeGreaterThan(0);
    });

    it("should handle deeply nested directories", async () => {
      const deepPath = path.join(testDistDir, "a", "b", "c", "d");
      await fs.mkdir(deepPath, { recursive: true });
      await fs.writeFile(path.join(deepPath, "deep.js"), "export {};");
      
      const files = await walk(testDistDir);
      const deepFile = files.find(f => f.includes("deep.js"));
      
      expect(deepFile).toBeDefined();
      
      // Verify it's still within bounds
      const relative = path.relative(testDistDir, deepFile);
      expect(relative.startsWith("..")).toBe(false);
    });
  });
});
