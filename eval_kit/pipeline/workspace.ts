import { cp, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export async function snapshotWorkspace(source: string, directory: string) {
  const hash = createHash("sha256");
  async function scan(root: string, prefix = "") {
    for (const entry of (await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error("项目素材不允许符号链接: " + name);
      hash.update(JSON.stringify([name,entry.isDirectory()?"directory":"file"]));
      if (entry.isDirectory()) await scan(join(root,entry.name),name+"/");
      else if (entry.isFile()) { const content=await readFile(join(root,entry.name)); hash.update(String(content.length)+":"); hash.update(content); }
      else throw new Error("项目素材包含非常规文件: " + name);
    }
  }
  // 准备时固定一份素材；后续各次运行只复制该目录，不重新读取可能被人工编辑的数据集。
  await cp(source,directory,{recursive:true,errorOnExist:true,force:false});
  await scan(directory);
  const digest = hash.digest("hex");
  return {directory,digest};
}
