import { expect, it } from "vitest";
import { containerCommand } from "../runner/container-client.js";
it("容器只挂载当前工作区、会话设置和 CLI，不挂载数据集或结果根目录；密钥不进命令行", () => {
  const launch = containerCommand({image:"eval:v1",name:"case-1",binary:"/opt/claude",workspace:"/results/r1/workspace",settings:"/results/r1/config",args:["--print","问题"]});
  const mounts = launch.args.flatMap((arg,i)=>arg==="--mount"?[launch.args[i+1]]:[]);
  expect(mounts).toHaveLength(3);
  expect(mounts).toContain("type=bind,source=/results/r1/workspace,target=/workspace");
  expect(launch.args).toContain("--read-only");
  expect(launch.args).toContain("--cap-drop=ALL");
  expect(launch.args).not.toContain("--privileged");
  expect(launch.args).toContain("ANTHROPIC_AUTH_TOKEN");
  expect(launch.args).toContain("MAX_THINKING_TOKENS");
  expect(launch.args.slice(-3)).toEqual(["claude","--print","问题"]);
});
