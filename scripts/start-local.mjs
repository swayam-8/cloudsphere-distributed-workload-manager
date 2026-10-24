// One-command local startup alongside other development projects.
process.env.CLOUDSPHERE_MONGO_PORT ||= '27028';
process.env.CLOUDSPHERE_API_PORT ||= '8019';
process.env.CLOUDSPHERE_WEB_PORT ||= '5199';
await import('./dev.mjs');
