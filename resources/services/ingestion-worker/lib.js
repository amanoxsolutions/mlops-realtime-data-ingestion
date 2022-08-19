const axios = require('axios');
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");

const ebClient = new EventBridgeClient({
  region: process.env.AWS_REGION,
});

// Function to compute the data size of an eventBridge PutEvents entry
// refer to https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-putevent-size.html
function getEntrySize(entry) {
  let size = 0;
  if (entry.Time != null) {
      size += 14;
  }
  size += Buffer.byteLength(entry.Source, 'utf8');
  size += Buffer.byteLength(entry.DetailType, 'utf8');
  if (entry.Detail != null) {
      size += Buffer.byteLength(entry.Detail, 'utf8');
  }
  if (entry.Resources != null) {
      for (let resource of entry.Resources) {
          if (resource != null) {
              size += Buffer.byteLength(resource, 'utf8');
          }
      }
  }
  return size;
}

// Function to pull data from the public API
async function ingestData(throwError = false) {
  try {
    latestblockResponse = await axios.get('https://blockchain.info/unconfirmed-transactions?format=json');
    const transactions = latestblockResponse.data;
    if (transactions) {
      console.log(`Pulled ${transactions.txs.length} data points from the public API`);
      return transactions;
    }
  } catch (error) {
    console.log(error);
    if (throwError) {
      throw new Error('Failed to get data from the public API');
    }
  }
}

async function pushEntriesOnEventBus(eventParams, throwError = false) {
  try {
    ebResponse = await ebClient.send(new PutEventsCommand(eventParams));
    console.log(`-- Pushed data points on the eventBus ${eventParams.Entries[0].EventBusName}`);
  } catch (error) {
    console.log(error);
    if (throwError) {
      throw new Error('-- Failed to push data on the eventBus');
    }
  }
}

// Function to push data on the eventBridge Bus
async function pushDataOnEventBus(data, detailType, throwError = false) {
  const eventBusName = process.env.EVENT_BUS_NAME || 'default';
  // create a parameter object with an empty list of entries
  
  let eventParams = {
    Entries: [],
  }; 
  // Try first to create an entry with all the data
  let entry = {
    EventBusName: eventBusName,
    Detail: JSON.stringify(data),
    DetailType: detailType,
    Source: 'Fargate Ingestion Worker',
    Resources: [
        process.env.KINESIS_FIREHOSE_ARN,
    ],
  }
  // The maximum event size is 256KB. If the event is greater than 256
  // we need to split it into multiple parts
  const entrySize = getEntrySize(entry);
  console.log(`-- Full data entry size is ${entrySize} bytes`);
  if (entrySize > 256000) {
    // get the total number of transactions
    const totalTransactions = data.txs.length;
    // loop through all the transactions and the transaction to the list of
    // entry transactions only if the size of the list doesn't go over 256KB
    let entryTransactions = [];
    let numberOfEntries = 1;
    let nbTransactions = 0;
    for (let i = 0; i < totalTransactions; i++) {
      // get the size of the current entry
      entry.Detail = JSON.stringify({txs: tempTransactions});
      currentEntrySize = getEntrySize(entry);
      // create a temporary transaction list equal to the current entry transactions
      let tempTransactions = [...entryTransactions];
      // add the transaction to the temporary transaction list
      tempTransactions.push(data.txs[i]);
      entry.Detail = JSON.stringify({txs: tempTransactions});
      // get the size of the temporary transaction list
      const tempEntrySize = getEntrySize(entry);
      //if there is only one transaction in the entry and it is superior to the 256KB limit
      // discard that event for the time being
      if (currentEntrySize > 256000 && entryTransactions.length == 1) {
        //if there is only one transaction in the entry and it is superior to the 256KB limit
        // discard that entry for the time being
        console.log(`-- Discarding entry ${numberOfEntries} containing 1 transaction of size ${tempEntrySize} bytes superior to the limit of 256KB`);
        entryTransactions = [data.txs[i]]; // we discard the existing transaction in the list
        nbTransactions = 1;
        numberOfEntries += 1;
      } else if (tempEntrySize > 256000) {
        // if the size of the temporary transaction list is greater than 256KB
        // we keep the entry transactions list as is and add it to the list of 
        // paramaters entries
        entry.Detail = JSON.stringify({txs: entryTransactions});
        console.log(`-- Entry ${numberOfEntries} contains ${nbTransactions} transactions for a total size of ${getEntrySize(entry)} bytes`);
        eventParams.Entries.push(entry)
        // we reset the list of entry transactions to the current transaction
        entryTransactions = [data.txs[i]];
        nbTransactions = 1;
        numberOfEntries += 1;
      } else {
        entryTransactions = [...tempTransactions];
        nbTransactions += 1;
      }
    }
    // if there are still transactions in the entry transactions list we need to 
    // add it to the entry and push it on the event bus
    if (entryTransactions.length > 0) {
      entry.Detail = JSON.stringify({txs: entryTransactions});
      console.log(`-- Entry ${numberOfEntries} contains ${nbTransactions} transactions for a total size of ${getEntrySize(entry)} bytes`);
      eventParams.Entries.push(entry)
    }
  } else {
    eventParams.Entries.push(entry)
  }
  pushEntriesOnEventBus(eventParams, throwError);
}

module.exports = { ingestData , pushDataOnEventBus };
