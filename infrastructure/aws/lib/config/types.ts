/**
 * Configuration types for OpenChamber AWS infrastructure
 */

export interface EnvironmentConfig {
  /**
   * AWS region for deployment
   */
  region: string;

  /**
   * AWS account ID
   */
  account: string;

  /**
   * Domain name for the application (e.g., openchamber.company.com)
   */
  domainName: string;

  /**
   * ARN of ACM certificate for HTTPS (manual mode)
   * If not provided, certificate will be auto-created using Route53 DNS validation
   * @example "arn:aws:acm:us-west-2:123456789012:certificate/abc-123"
   */
  certificateArn?: string;

  /**
   * Route53 Hosted Zone ID for DNS and certificate validation (auto mode)
   * Required when certificateArn is not provided
   * @example "Z0123456789ABCDEFGHIJ"
   */
  hostedZoneId?: string;

  /**
   * Route53 Hosted Zone name (auto mode)
   * Required when hostedZoneId is provided
   * @example "opencode.company.dev"
   */
  hostedZoneName?: string;

  /**
   * Enable Cognito authentication
   * @default true
   */
  cognitoEnabled: boolean;

  /**
   * Existing Cognito User Pool ID to import
   * If not provided and cognitoEnabled=true, creates new pool
   * @example "us-west-2_hZpW7gd5N"
   */
  cognitoUserPoolId?: string;

  /**
   * Cognito domain prefix for existing User Pool
   * Required when cognitoUserPoolId is provided
   * @example "transformers-auth"
   */
  cognitoDomainPrefix?: string;

  /**
   * Git user name for commits
   * @default "OpenChamber Bot"
   */
  gitUserName: string;

  /**
   * Git user email for commits
   * @default "openchamber@company.com"
   */
  gitUserEmail: string;

  /**
   * Fargate CPU units (256, 512, 1024, 2048, 4096, 8192, 16384)
   * @default 4096
   */
  fargateCpu: number;

  /**
   * Fargate memory in MB
   * @default 8192
   */
  fargateMemory: number;

  /**
   * Stack name
   * @default "OpenchamberStack"
   */
  stackName: string;
}

/**
 * Parse environment variables into configuration
 */
export function parseConfig(): EnvironmentConfig {
  const region = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';
  const account = process.env.AWS_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT;

  if (!account) {
    throw new Error('AWS_ACCOUNT or CDK_DEFAULT_ACCOUNT environment variable is required');
  }

  const domainName = process.env.DOMAIN_NAME;
  if (!domainName) {
    throw new Error('DOMAIN_NAME environment variable is required');
  }

  const certificateArn = process.env.CERTIFICATE_ARN;
  const hostedZoneId = process.env.HOSTED_ZONE_ID;
  const hostedZoneName = process.env.HOSTED_ZONE_NAME;

  // Validate certificate configuration - must provide either certificateArn OR hostedZoneId
  if (!certificateArn && !hostedZoneId) {
    throw new Error(
      'Either CERTIFICATE_ARN or HOSTED_ZONE_ID must be provided.\n' +
      '  - Manual mode: Set CERTIFICATE_ARN with pre-created ACM certificate\n' +
      '  - Auto mode: Set HOSTED_ZONE_ID and HOSTED_ZONE_NAME for automatic certificate creation'
    );
  }

  if (certificateArn && hostedZoneId) {
    console.warn(
      'Warning: Both CERTIFICATE_ARN and HOSTED_ZONE_ID are set. ' +
      'Using CERTIFICATE_ARN (manual mode). Remove CERTIFICATE_ARN to enable auto mode.'
    );
  }

  if (hostedZoneId && !hostedZoneName) {
    throw new Error(
      'HOSTED_ZONE_NAME is required when HOSTED_ZONE_ID is provided. ' +
      'This should match your Route53 hosted zone name (e.g., "opencode.compoanuy.dev")'
    );
  }

  const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID;
  const cognitoDomainPrefix = process.env.COGNITO_DOMAIN_PREFIX;

  // Validate Cognito configuration
  if (cognitoUserPoolId && !cognitoDomainPrefix) {
    throw new Error(
      'COGNITO_DOMAIN_PREFIX is required when using existing User Pool (COGNITO_USER_POOL_ID). ' +
      'Find your domain prefix at: AWS Console → Cognito → User Pools → App Integration → Domain'
    );
  }

  if (cognitoDomainPrefix && !cognitoUserPoolId) {
    console.warn(
      'Warning: COGNITO_DOMAIN_PREFIX is set but COGNITO_USER_POOL_ID is not. ' +
      'Domain prefix will be ignored, creating new User Pool.'
    );
  }

  return {
    region,
    account,
    domainName,
    certificateArn: certificateArn || undefined,
    hostedZoneId: hostedZoneId || undefined,
    hostedZoneName: hostedZoneName || undefined,
    cognitoEnabled: process.env.COGNITO_ENABLED !== 'false',
    cognitoUserPoolId: cognitoUserPoolId || undefined,
    cognitoDomainPrefix: cognitoDomainPrefix || undefined,
    gitUserName: process.env.GIT_USER_NAME || 'OpenChamber Bot',
    gitUserEmail: process.env.GIT_USER_EMAIL || 'openchamber@company.com',
    fargateCpu: parseInt(process.env.FARGATE_CPU || '4096', 10),
    fargateMemory: parseInt(process.env.FARGATE_MEMORY || '8192', 10),
    stackName: process.env.STACK_NAME || 'OpenchamberStack',
  };
}

/**
 * Validate CPU/Memory combination for Fargate
 */
export function validateFargateConfig(cpu: number, memory: number): void {
  const validCombinations: Record<number, number[]> = {
    256: [512, 1024, 2048],
    512: [1024, 2048, 3072, 4096],
    1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
    2048: [4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384],
    4096: [8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384, 17408, 18432, 19456, 20480, 21504, 22528, 23552, 24576, 25600, 26624, 27648, 28672, 29696, 30720],
  };

  const validMemories = validCombinations[cpu];
  if (!validMemories || !validMemories.includes(memory)) {
    throw new Error(
      `Invalid Fargate CPU/Memory combination: ${cpu}/${memory}. ` +
      `Valid memory values for CPU ${cpu}: ${validMemories?.join(', ') || 'none'}`
    );
  }
}
