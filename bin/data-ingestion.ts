#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataIngestionPipelineStack } from '../lib/pipeline-stack';
import { getCurrentBranchName } from '../lib/git-branch'

const app = new cdk.App();

// The code in the current active branch will be the one deployed by the pipeline
// The branch name is used to create a Hash for all the resources created by the pipeline
// This allows to deploy multiple versions of the same code in parallel the same AWS Account
let branchToDeploy;
try {
  const branchToDeployParam = new cdk.CfnParameter(app, 'branchToDeploy', {
    type: 'String',
    description: 'The name of the GitHub branch to deploy',
  });
  branchToDeploy = branchToDeployParam.valueAsString;
} catch(error) {
  branchToDeploy = getCurrentBranchName() || 'unknown';
  if (branchToDeploy === 'unknown') {
    throw new Error('Could not determine the current branch name from the CDK Stack paramteter nor the Git branch name');
  }
}
console.log('Current branch name: 👉 ', branchToDeploy);

new DataIngestionPipelineStack(app, 'DataIngestionPipelineStack', {
  repoName: 'amanoxsolutions/mlops-realtime-data-ingestion',
  codestarConnectionName: 'mlops-realtime-data-ingestion',
  branchName: branchToDeploy,
});

app.synth();