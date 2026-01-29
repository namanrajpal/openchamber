#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OpenchamberStack } from '../lib/openchamber-stack';
import { parseConfig } from '../lib/config/types';

const app = new cdk.App();

// Parse configuration from environment variables
const config = parseConfig();

// Create the stack
new OpenchamberStack(app, config.stackName, {
  config,
  env: {
    account: config.account,
    region: config.region,
  },
  description: 'OpenChamber AWS infrastructure - Web interface for OpenCode AI agent',
  tags: {
    Application: 'OpenChamber',
    ManagedBy: 'CDK',
    Environment: process.env.ENVIRONMENT || 'production',
  },
});
