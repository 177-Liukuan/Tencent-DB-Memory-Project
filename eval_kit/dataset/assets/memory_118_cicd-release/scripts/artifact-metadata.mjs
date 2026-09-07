import fs from 'node:fs';
import crypto from 'node:crypto';
export function metadata(file) {
    const bytes = fs.readFileSync(file);
    return {
        file,
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        generatedAt: new Date().toISOString(),
    };
}
if (process.argv[1]?.endsWith('artifact-metadata.mjs') && process.argv[2]) {
    console.log(JSON.stringify(metadata(process.argv[2]), null, 2));
}
