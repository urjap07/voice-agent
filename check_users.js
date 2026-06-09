const { DatabaseSync } = require('node:sqlite');
const path = require('path');

async function check() {
    try {
        const dbPath = path.join(process.env.HOME || '/Users/Urja', '.n8n', 'database.sqlite');
        const db = new DatabaseSync(dbPath);
        const query = db.prepare("SELECT id, name, active FROM workflow_entity");
        console.log('Workflows:', query.all());
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}
check();


