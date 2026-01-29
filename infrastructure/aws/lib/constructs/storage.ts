import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface StorageConstructProps {
  /**
   * VPC for EFS mount targets
   */
  vpc: ec2.IVpc;

  /**
   * Security group for EFS
   */
  securityGroup: ec2.ISecurityGroup;
}

/**
 * Storage construct for OpenChamber
 * Creates EFS file system for shared workspace
 */
export class StorageConstruct extends Construct {
  public readonly fileSystem: efs.IFileSystem;
  public readonly accessPoint: efs.IAccessPoint;

  constructor(scope: Construct, id: string, props: StorageConstructProps) {
    super(scope, id);

    // Create encrypted EFS file system
    this.fileSystem = new efs.FileSystem(this, 'OpenchamberFileSystem', {
      vpc: props.vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS, // Transition to IA after 30 days
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: RemovalPolicy.RETAIN, // Protect data on stack deletion
      securityGroup: props.securityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      enableAutomaticBackups: true,
    });

    // Create access point for shared workspace
    this.accessPoint = new efs.AccessPoint(this, 'WorkspaceAccessPoint', {
      fileSystem: this.fileSystem,
      path: '/workspace',
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '755',
      },
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
    });
  }
}
