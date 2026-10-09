const serverless = require('serverless-http');
const app = require('../../server/app');
const setupDatabase = require('../../server/models/setup');

const handleRequest = serverless(app);
let databaseReady;

function ensureDatabase() {
  if (!databaseReady) {
    databaseReady = setupDatabase().catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  return databaseReady;
}

exports.handler = async (event, context) => {
  await ensureDatabase();
  return handleRequest(event, context);
};
