import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ComputeConstructProps {
  /**
   * VPC for ECS cluster
   */
  vpc: ec2.IVpc;

  /**
   * Security group for Fargate tasks
   */
  securityGroup: ec2.ISecurityGroup;

  /**
   * EFS file system for shared workspace
   */
  fileSystem: efs.IFileSystem;

  /**
   * EFS access point
   */
  accessPoint: efs.IAccessPoint;

  /**
   * Fargate CPU units
   */
  cpu: number;

  /**
   * Fargate memory in MB
   */
  memory: number;

  /**
   * Git user name for commits
   */
  gitUserName: string;

  /**
   * Git user email for commits
   */
  gitUserEmail: string;

  /**
   * AWS Account ID (for ECR ARN construction)
   */
  accountId: string;

  /**
   * AWS Region (for ECR ARN construction)
   */
  region: string;
}

/**
 * Compute construct for OpenChamber
 * Creates ECR repository, ECS cluster, and Fargate service
 */
export class ComputeConstruct extends Construct {
  public readonly repository: ecr.IRepository;
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly taskDefinition: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: ComputeConstructProps) {
    super(scope, id);

    const repositoryName = 'openchamber';

    // Try to import existing ECR repository, or create a new one
    // This handles the case where the stack was deleted but ECR was retained
    try {
      // Check if we should import an existing repository
      const existingRepoArn = `arn:aws:ecr:${props.region}:${props.accountId}:repository/${repositoryName}`;
      
      // Use fromRepositoryArn to import if it exists (won't fail during synth)
      // The actual validation happens during deployment
      this.repository = ecr.Repository.fromRepositoryArn(
        this,
        'ImportedRepository',
        existingRepoArn
      );
      
      console.log(`Using existing ECR repository: ${repositoryName}`);
    } catch {
      // Create new ECR repository for Docker images
      this.repository = new ecr.Repository(this, 'OpenchamberRepository', {
        repositoryName: repositoryName,
        removalPolicy: RemovalPolicy.RETAIN, // Keep images on stack deletion
        lifecycleRules: [
          {
            maxImageCount: 5, // Keep only last 5 images
            description: 'Keep only 5 most recent images',
          },
        ],
        imageScanOnPush: true, // Security: scan for vulnerabilities
      });
    }

    // Create ECS cluster
    this.cluster = new ecs.Cluster(this, 'OpenchamberCluster', {
      vpc: props.vpc,
      clusterName: 'openchamber-cluster',
      containerInsights: true, // Enable Container Insights for monitoring
    });

    // Create CloudWatch log group
    const logGroup = new logs.LogGroup(this, 'OpenchamberLogGroup', {
      logGroupName: '/ecs/openchamber',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // Create Fargate task definition
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'OpenchamberTaskDefinition', {
      cpu: props.cpu,
      memoryLimitMiB: props.memory,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Grant EFS access to task
    props.fileSystem.grant(this.taskDefinition.taskRole, 'elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite');

    // Add EFS volume to task definition
    const volumeName = 'workspace';
    this.taskDefinition.addVolume({
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: props.fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: props.accessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Add container to task definition
    const container = this.taskDefinition.addContainer('openchamber', {
      containerName: 'openchamber',
      image: ecs.ContainerImage.fromEcrRepository(this.repository, 'latest'),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'openchamber',
        logGroup: logGroup,
      }),
      environment: {
        HOME: '/workspace',
        GIT_USER_NAME: props.gitUserName,
        GIT_USER_EMAIL: props.gitUserEmail,
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/api/health || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
    });

    // Add port mapping
    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    // Mount EFS volume
    container.addMountPoints({
      sourceVolume: volumeName,
      containerPath: '/workspace',
      readOnly: false,
    });

    // Create Fargate service
    this.service = new ecs.FargateService(this, 'OpenchamberService', {
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      serviceName: 'openchamber-service',
      desiredCount: 1,
      assignPublicIp: false, // Private subnets only
      securityGroups: [props.securityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      enableExecuteCommand: true, // Enable ECS Exec for debugging
      healthCheckGracePeriod: Duration.seconds(60),
      circuitBreaker: {
        rollback: true, // Auto-rollback on deployment failure
      },
    });

    // Grant permissions for ECS Exec
    this.service.taskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );

    // Grant Amazon Bedrock permissions for AI model access
    this.taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:GetFoundationModel',
        'bedrock:ListFoundationModels',
      ],
      resources: ['*'], // Bedrock model ARNs vary by region and model
    }));
  }
}
