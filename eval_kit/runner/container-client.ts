export function containerCommand(input: {image:string;name:string;binary:string;workspace:string;settings:string;args:string[]}) {
  for (const path of [input.binary,input.workspace,input.settings]) if (path.includes(",")) throw new Error("容器挂载路径不能包含逗号");
  // 不能把 results/ 或仓库整体挂进容器，否则模型可直接读取标签、种子和另一组答案。
  return {command:"docker",args:["run","--rm","--name",input.name,"--network","host","--read-only",
    "--cap-drop=ALL","--security-opt=no-new-privileges:true","--user",`${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "--tmpfs","/tmp:rw,mode=1777","--tmpfs","/root:rw,mode=1777",
    "--mount",`type=bind,source=${input.workspace},target=/workspace`,
    "--mount",`type=bind,source=${input.settings},target=/session`,
    "--mount",`type=bind,source=${input.binary},target=/usr/local/bin/claude,readonly`,
    "--workdir","/workspace",
    ...["ANTHROPIC_BASE_URL","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_CUSTOM_HEADERS","ANTHROPIC_MODEL","MAX_THINKING_TOKENS",
      "NO_PROXY","no_proxy","HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy"].flatMap(name=>["--env",name]),
    "--env","CLAUDE_CONFIG_DIR=/session",input.image,"claude",...input.args]};
}
