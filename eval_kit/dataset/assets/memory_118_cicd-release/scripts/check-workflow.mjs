import fs from 'node:fs';
const text = fs.readFileSync('.github/workflows/release.yml', 'utf8');
for (const needle of ['verify:', 'package:', 'needs: verify']) {
    if (!text.includes(needle)) {
        console.error(`missing ${needle}`);
        process.exit(1);
    }
}
console.log('workflow structure ok');
