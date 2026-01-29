import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { EnvironmentConfig, validateFargateConfig } from './config/types';
import { NetworkConstruct } from './constructs/network';
import { StorageConstruct } from './constructs/storage';
import { AuthConstruct } from './constructs/auth';
import { ComputeConstruct } from './constructs/compute';
import { LoadBalancerConstruct } from './constructs/loadbalancer';

export interface OpenchamberStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Main CDK stack for OpenChamber deployment on AWS
 */
export class OpenchamberStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OpenchamberStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Validate Fargate configuration
    validateFargateConfig(config.fargateCpu, config.fargateMemory);

    // Phase 1: Network Infrastructure
    const network = new NetworkConstruct(this, 'Network');

    // Phase 2: Storage
    const storage = new StorageConstruct(this, 'Storage', {
      vpc: network.vpc,
      securityGroup: network.efsSecurityGroup,
    });

    // Phase 3: Authentication (optional)
    let auth: AuthConstruct | undefined;
    if (config.cognitoEnabled) {
      auth = new AuthConstruct(this, 'Auth', {
        domainName: config.domainName,
        existingUserPoolId: config.cognitoUserPoolId,
        existingDomainPrefix: config.cognitoDomainPrefix,
      });
    }

    // Phase 4: Compute (ECR, ECS, Fargate)
    const compute = new ComputeConstruct(this, 'Compute', {
      vpc: network.vpc,
      securityGroup: network.fargateSecurityGroup,
      fileSystem: storage.fileSystem,
      accessPoint: storage.accessPoint,
      cpu: config.fargateCpu,
      memory: config.fargateMemory,
      gitUserName: config.gitUserName,
      gitUserEmail: config.gitUserEmail,
      accountId: config.account,
      region: config.region,
    });

    // Import hosted zone if provided (for auto certificate mode)
    let hostedZone: route53.IHostedZone | undefined;
    if (config.hostedZoneId && config.hostedZoneName) {
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: config.hostedZoneId,
        zoneName: config.hostedZoneName,
      });
    }

    // Phase 5: Load Balancer
    const loadbalancer = new LoadBalancerConstruct(this, 'LoadBalancer', {
      vpc: network.vpc,
      securityGroup: network.albSecurityGroup,
      service: compute.service,
      certificateArn: config.certificateArn,
      hostedZone: hostedZone,
      domainName: config.domainName,
      userPool: auth?.userPool,
      userPoolClient: auth?.userPoolClient,
      cognitoDomain: auth?.cognitoDomain,
      cognitoDomainPrefix: auth?.cognitoDomainPrefix,
    });

    // Stack Outputs
    new cdk.CfnOutput(this, 'ALBDnsName', {
      value: loadbalancer.alb.loadBalancerDnsName,
      description: 'ALB DNS name - Create CNAME record pointing to this',
      exportName: `${id}-ALBDnsName`,
    });

    new cdk.CfnOutput(this, 'ECRRepositoryUri', {
      value: compute.repository.repositoryUri,
      description: 'ECR repository URI for Docker images',
      exportName: `${id}-ECRRepositoryUri`,
    });

    new cdk.CfnOutput(this, 'ECSClusterName', {
      value: compute.cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `${id}-ECSClusterName`,
    });

    new cdk.CfnOutput(this, 'ECSServiceName', {
      value: compute.service.serviceName,
      description: 'ECS service name',
      exportName: `${id}-ECSServiceName`,
    });

    if (auth) {
      new cdk.CfnOutput(this, 'CognitoUserPoolId', {
        value: auth.userPool.userPoolId,
        description: 'Cognito User Pool ID',
        exportName: `${id}-CognitoUserPoolId`,
      });

      new cdk.CfnOutput(this, 'CognitoUserPoolClientId', {
        value: auth.userPoolClient.userPoolClientId,
        description: 'Cognito User Pool Client ID',
        exportName: `${id}-CognitoUserPoolClientId`,
      });

      if (auth.cognitoDomain) {
        new cdk.CfnOutput(this, 'CognitoDomain', {
          value: `https://${auth.cognitoDomain.domainName}.auth.${config.region}.amazoncognito.com`,
          description: 'Cognito hosted UI domain',
          exportName: `${id}-CognitoDomain`,
        });
      } else if (auth.cognitoDomainPrefix) {
        new cdk.CfnOutput(this, 'CognitoDomain', {
          value: `https://${auth.cognitoDomainPrefix}.auth.${config.region}.amazoncognito.com`,
          description: 'Cognito hosted UI domain',
          exportName: `${id}-CognitoDomain`,
        });
      }
    }

    new cdk.CfnOutput(this, 'ApplicationUrl', {
      value: `https://${config.domainName}`,
      description: 'Application URL (after DNS configuration)',
    });

    // Add tags to all resources
    cdk.Tags.of(this).add('Application', 'OpenChamber');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}
