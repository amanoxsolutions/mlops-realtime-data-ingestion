#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataIngestionPipelineStack } from '../lib/pipeline-stack';
import { getCurrentBranchName, getShortHashFromString } from '../lib/git-branch';

const app = new cdk.App();

// Finds the current branch name from the .git/HEAD file
const currentBranch = getCurrentBranchName() || 'unknown';
if (currentBranch === 'unknown') {
  throw new Error('Could not determine the branch name to deploy from the local .git/HEAD file');
}
console.log('Current branch name: 👉 ', currentBranch);

// Get the first 6 characters of the hash value computed from the Git branch name
// and use it in the prefix of all the resource names
const branchHash = getShortHashFromString(currentBranch);
console.log('Hash value computed from the branch name and used for resource names: 👉 ', branchHash);
const prefix = `mlops-rdi-${currentBranch.substring(0,4)}${branchHash}`;
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
  branchName: currentBranch,
});

app.synth();
