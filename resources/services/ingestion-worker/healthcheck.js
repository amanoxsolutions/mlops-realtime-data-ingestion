const lib = require('./lib.js');

// Health check function
async function healthCheck() {
  // Verify it can read data from the public API
  const data = await lib.ingestData(true);
  // Verify it can push data on the eventBus
  // the data are put on the bus with the detailType of 'Health Check'
  // which should be filtered out by the eventBus rule and thus 
  // not processed by the ingestion pipeline
  if (data) {
    await lib.pushDataOnEventBus(data, 'Health Check', true);
  }
}

healthCheck();
