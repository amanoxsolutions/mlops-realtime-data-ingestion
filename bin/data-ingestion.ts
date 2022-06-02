#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataIngestionPipelineStack, StageType } from '../lib/pipeline-stack';

const app = new cdk.App();
new DataIngestionPipelineStack(app, 'DataIngestionPipelineStack', {
  prefix: '3mr50x-mlops-rdi',
  repoName: 'amanoxsolutions/mlops-realtime-data-ingestion',
  stage: StageType.DEV,
  codestarConnectionName: 'mlops-realtime-data-ingestion',
});

app.synth();