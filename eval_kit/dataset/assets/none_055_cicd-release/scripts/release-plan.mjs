const env = process.env.DEPLOY_ENV ?? 'staging';
const artifact = process.env.ARTIFACT_ID ?? 'checkout-service-local';
console.log(JSON.stringify({ env, artifact, steps: ['verify', 'package', 'promote', 'observe'] }, null, 2));

