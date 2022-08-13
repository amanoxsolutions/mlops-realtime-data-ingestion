const lib = require('./lib');

const detailType = process.env.EVENT_DETAIL_TYPE || 'Incoming Data'

async function main() {
  const data = await lib.ingestData();
  if (data) {
    await lib.pushDataOnEventBus(data, detailType);
  }
}

// Loop infinitely to ingest data
setInterval(main, process.env.INGESTION_INTERVAL || 1000);