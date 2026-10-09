const proxyToBackend = require('../serverless/backend-proxy');

module.exports = proxyToBackend;
module.exports.config = {
  api: {
    bodyParser: false
  }
};
