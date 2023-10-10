#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataIngestionPipelineStack } from '../lib/pipeline-stack';
import { nthIndexOf, getCurrentBranchName, getShortHashFromString } from '../lib/git-branch';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

const app = new cdk.App();

// Finds the current branch name from the .git/HEAD file
const fullBranchName = getCurrentBranchName() || 'unknown';
if (fullBranchName === 'unknown') {
  throw new Error('Could not determine the branch name to deploy from the local .git/HEAD file');
}
console.log('Current branch name: 👉 ', fullBranchName);
// Get the last string after the last "/" in the branch reference name
const nb_delimiters = (fullBranchName.match(/\//g) || []).length;
const start = nthIndexOf(fullBranchName, '/', nb_delimiters);
const shortBranchName = fullBranchName.substring(start+1);
console.log('Short branch name used for naming: 👉 ', shortBranchName);            

// Get the first 6 characters of the hash value computed from the Git branch name
// and use it in the prefix of all the resource names
const branchHash = getShortHashFromString(shortBranchName);
console.log('Hash value computed from the branch name and used for resource names: 👉 ', branchHash);
const prefix = `mlops-rdi-${shortBranchName.substring(0,4)}${branchHash}`;
console.log('Prefix for all resources deployed by this stack: 👉 ', prefix);

new DataIngestionPipelineStack(app, `${prefix}-DataIngestionPipelineStack`, {
  // 👇 explicitly setting account and region
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  prefix: prefix,
  repoName: 'amanoxsolutions/mlops-realtime-data-ingestion',
  codestarConnectionName: 'mlops-realtime-data-ingestion',
  fullBranchName: fullBranchName,
  shortBranchName: shortBranchName,
  customResourceLayerRuntime: Runtime.PYTHON_3_9,
});

app.synth();
