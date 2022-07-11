#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataIngestionPipelineStack } from '../lib/pipeline-stack';
import { getCurrentBranchName } from '../lib/git-branch';

const app = new cdk.App();

// Finds the current branch name from the .git/HEAD file
const currentBranch = getCurrentBranchName() || 'unknown';
if (currentBranch === 'unknown') {
  throw new Error('Could not determine the branch name to deploy from the local .git/HEAD file');
}
console.log('Current branch name: 👉 ', currentBranch);

new DataIngestionPipelineStack(app, 'DataIngestionPipelineStack', {
  repoName: 'amanoxsolutions/mlops-realtime-data-ingestion',
  codestarConnectionName: 'mlops-realtime-data-ingestion',
  branchName: currentBranch,
});

app.synth();