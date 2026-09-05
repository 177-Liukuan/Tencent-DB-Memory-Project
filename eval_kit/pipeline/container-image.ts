import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
export async function prepareClientImage(image: string, uvBinary: string, claudeBinary: string) {
  const exists = await exec("docker",["image","inspect",image,"--format","{{.Id}}"])
    .then(r=>r.stdout.trim()).catch(()=>null);
  if (!exists) {
    const context = await mkdtemp(join(tmpdir(),"tdai-eval-image-"));
    await cp(dirname(dirname(await realpath(process.execPath))),join(context,"node"),{recursive:true,verbatimSymlinks:true});
    await cp(uvBinary,join(context,"uv"));
    process.stderr.write("[pipeline] building shared CLI image (not part of task latency)\n");
    const output = await exec("docker",["build","--network","host","--build-arg",`EVAL_UID=${process.getuid?.() ?? 1000}`,"--build-arg",`EVAL_GID=${process.getgid?.() ?? 1000}`,"--build-arg","HTTP_PROXY","--build-arg","HTTPS_PROXY","--build-arg","http_proxy","--build-arg","https_proxy","--tag",image,"--file",fileURLToPath(new URL("Dockerfile",import.meta.url)),context],{
      env:{...process.env,http_proxy:process.env.http_proxy ?? process.env.HTTP_PROXY,https_proxy:process.env.https_proxy ?? process.env.HTTPS_PROXY},
      maxBuffer:10*1024*1024,timeout:600_000});
    process.stderr.write(output.stderr.slice(-1500));
  }
  // 用真实容器验证隔离与运行环境；不把宿主机目录整体挂进去。
  const binary = await realpath(claudeBinary);
  const probe = await exec("docker",["run","--rm","--network","none","--read-only",
    "--user",`${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,"--tmpfs","/tmp:rw,mode=1777","--workdir","/tmp",
    "--mount",`type=bind,source=${binary},target=/usr/local/bin/claude,readonly`,image,
    "sh","-c","test ! -e /home/liukuan/Tencent-DB-Memory-Project && node -e 'require(\"fs\").mkdirSync(require(\"os\").homedir()+\"/.cache\",{recursive:true})' && node --version && python3 --version && pnpm --version && uv --version && claude --version"],{timeout:30_000});
  return {image,id:(await exec("docker",["image","inspect",image,"--format","{{.Id}}"])).stdout.trim(),versions:probe.stdout.trim()};
}
