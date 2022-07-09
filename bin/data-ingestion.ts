#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataIngestionPipelineStack } from '../lib/pipeline-stack';
import { getCurrentBranchName } from '../lib/git-branch'

const app = new cdk.App();
let currentBranch = getCurrentBranchName() || 'unknown';
console.log('Current branch name: ', currentBranch);

new DataIngestionPipelineStack(app, 'DataIngestionPipelineStack', {
  repoName: 'amanoxsolutions/mlops-realtime-data-ingestion',
  codestarConnectionName: 'mlops-realtime-data-ingestion',
  // The code in the current active branch will be the one deployed by the pipeline
  // The branch name is used to create a Hash for all the resources created by the pipeline
  // This allows to deploy multiple versions of the same code in parallel the same AWS Account
  branchName: currentBranch,
});

app.synth();