import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface NetworkConstructProps {
  /**
   * CIDR block for the VPC
   * @default '10.0.0.0/16'
   */
  vpcCidr?: string;

  /**
   * Maximum number of availability zones
   * @default 2
   */
  maxAzs?: number;
}

/**
 * Network construct for OpenChamber
 * Creates VPC with public/private subnets, NAT Gateway, and security groups
 */
export class NetworkConstruct extends Construct {
  public readonly vpc: ec2.IVpc;
  public readonly albSecurityGroup: ec2.ISecurityGroup;
  public readonly fargateSecurityGroup: ec2.ISecurityGroup;
  public readonly efsSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props?: NetworkConstructProps) {
    super(scope, id);

    // Create VPC with public and private subnets
    this.vpc = new ec2.Vpc(this, 'OpenchamberVpc', {
      ipAddresses: ec2.IpAddresses.cidr(props?.vpcCidr || '10.0.0.0/16'),
      maxAzs: props?.maxAzs || 2,
      natGateways: 1, // Single NAT Gateway for cost optimization
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Security Group for Application Load Balancer
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for OpenChamber ALB',
      allowAllOutbound: true,
    });

    // Allow HTTPS traffic from anywhere
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from anywhere'
    );

    // Allow HTTP traffic (for redirect to HTTPS)
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic for redirect'
    );

    // Security Group for Fargate Tasks
    this.fargateSecurityGroup = new ec2.SecurityGroup(this, 'FargateSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for OpenChamber Fargate tasks',
      allowAllOutbound: true,
    });

    // Allow traffic from ALB to Fargate on port 3000
    this.fargateSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(3000),
      'Allow traffic from ALB to Fargate'
    );

    // Security Group for EFS
    this.efsSecurityGroup = new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for OpenChamber EFS',
      allowAllOutbound: false,
    });

    // Allow NFS traffic from Fargate to EFS
    this.efsSecurityGroup.addIngressRule(
      this.fargateSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow NFS traffic from Fargate'
    );
  }
}
