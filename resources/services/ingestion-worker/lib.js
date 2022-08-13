const axios = require('axios');
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");

const ebClient = new EventBridgeClient({
  region: process.env.AWS_REGION,
});

// Function to pull data from the public API
async function ingestData() {
  try {
    latestblockResponse = await axios.get('https://blockchain.info/latestblock');
    const block_hash = latestblockResponse.data.hash;
    // If we have a block hash, then we can get the block data
    if (block_hash) {
      rawblockResponse = await axios.get(`https://blockchain.info/rawblock/${block_hash}`);
      const block_data = rawblockResponse.data;
      // If we have block data, then we can send it to EventBridge
      if (block_data) {
        return block_data;
      }
    }
  } catch (error) {
    console.log(error);
    throw new Error('Pulling data from public API failed');
  }
}

// Function to push data on the eventBridge Bus
async function pushDataOnEventBus(data, detailType) {
  const eventBusName = process.env.EVENT_BUS_NAME || 'default';
  console.log(`Pushed ${data.tx.length} data points on the eventBus ${eventBusName}`);
  const params = {
    Entries: [
      {
        EventBusName: eventBusName,
        Detail: data,
        DetailType: detailType,
        Source: 'Fargate Ingestion Worker',
        Resources: [
            process.env.KINESIS_FIREHOSE_ARN,
        ],
      },
    ],
  }; 
  try {
    ebResponse = await ebClient.send(new PutEventsCommand(params));
    console.log(`Pushed ${data.tx.length} data points on the eventBus ${eventBusName}`);
  } catch (error) {
    console.log(error);
    throw new Error('Pushing data on the eventBus failed');
  }
}

module.exports = { ingestData , pushDataOnEventBus };