import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const target = path.resolve(projectRoot, ".eve", ".workflow-data");
const expected = path.join(projectRoot, ".eve", ".workflow-data");

if (target !== expected || !target.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error(`Refusing to prune unexpected path: ${target}`);
}

let files = 0;
let bytes = 0;

async function measure(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to traverse symbolic link: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      await measure(entryPath);
    } else if (entry.isFile()) {
      const stat = await lstat(entryPath);
      files += 1;
      bytes += stat.size;
    }
  }
}

try {
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Refusing to prune non-directory or symbolic-link target: ${target}`);
  }
  await measure(target);
  await rm(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 250 });
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

await mkdir(path.join(target, "streams"), { recursive: true });
process.stdout.write(
  `${JSON.stringify({ target, filesRemoved: files, gibRemoved: Number((bytes / 1024 ** 3).toFixed(3)) }, null, 2)}\n`,
);
