import { spawnSync } from 'node:child_process';
const commands = [['npx', ['tsc', '-p', 'tsconfig.json']], ['node', ['--test', 'dist/tests/*.test.js']]];
for (const [cmd, args] of commands) {
    const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
    if (r.status !== 0)
        process.exit(r.status ?? 1);
}

