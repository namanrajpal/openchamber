import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2Actions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface LoadBalancerConstructProps {
  /**
   * VPC for ALB
   */
  vpc: ec2.IVpc;

  /**
   * Security group for ALB
   */
  securityGroup: ec2.ISecurityGroup;

  /**
   * Fargate service to target
   */
  service: ecs.FargateService;

  /**
   * Certificate ARN for HTTPS (manual mode)
   * If not provided, certificate will be auto-created using hostedZone
   */
  certificateArn?: string;

  /**
   * Route53 Hosted Zone for auto certificate creation (auto mode)
   * Required when certificateArn is not provided
   */
  hostedZone?: route53.IHostedZone;

  /**
   * Domain name
   */
  domainName: string;

  /**
   * Cognito User Pool (optional)
   */
  userPool?: cognito.IUserPool;

  /**
   * Cognito User Pool Client (optional)
   */
  userPoolClient?: cognito.IUserPoolClient;

  /**
   * Cognito Domain (optional - for new pool mode)
   */
  cognitoDomain?: cognito.IUserPoolDomain;

  /**
   * Cognito domain prefix (optional - for existing pool mode)
   * Used when importing existing User Pool
   * @example "transformers-auth"
   */
  cognitoDomainPrefix?: string;
}

/**
 * Load Balancer construct for OpenChamber
 * Creates ALB with HTTPS listener and optional Cognito authentication
 */
export class LoadBalancerConstruct extends Construct {
  public readonly alb: elbv2.IApplicationLoadBalancer;
  public readonly listener: elbv2.IApplicationListener;
  public readonly targetGroup: elbv2.IApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: LoadBalancerConstructProps) {
    super(scope, id);

    // Create Application Load Balancer
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'OpenchamberALB', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.securityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Get or create certificate
    let certificate: acm.ICertificate;

    if (props.certificateArn) {
      // Manual mode: Import existing certificate
      certificate = acm.Certificate.fromCertificateArn(
        this,
        'ImportedCertificate',
        props.certificateArn
      );
    } else if (props.hostedZone) {
      // Auto mode: Create certificate with DNS validation
      certificate = new acm.Certificate(this, 'AutoCertificate', {
        domainName: props.domainName,
        validation: acm.CertificateValidation.fromDns(props.hostedZone),
      });

      // Create DNS A record pointing to ALB
      new route53.ARecord(this, 'DNSRecord', {
        zone: props.hostedZone,
        recordName: props.domainName.replace(`.${props.hostedZone.zoneName}`, ''),
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(this.alb)
        ),
      });
    } else {
      throw new Error('Either certificateArn or hostedZone must be provided');
    }

    // Create target group
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'OpenchamberTargetGroup', {
      vpc: props.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/api/health',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: Duration.seconds(30),
    });

    // Attach Fargate service to target group
    this.targetGroup.addTarget(
      props.service.loadBalancerTarget({
        containerName: 'openchamber',
        containerPort: 3000,
      })
    );

    // Create HTTPS listener
    this.listener = this.alb.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'Not Found',
      }),
    });

    // Configure authentication if Cognito is enabled
    if (props.userPool && props.userPoolClient) {
      // Determine the User Pool Domain to use
      let userPoolDomain: cognito.IUserPoolDomain;

      if (props.cognitoDomain) {
        // New pool mode - use created domain
        userPoolDomain = props.cognitoDomain;
      } else if (props.cognitoDomainPrefix) {
        // Existing pool mode - import domain by prefix
        userPoolDomain = cognito.UserPoolDomain.fromDomainName(
          this,
          'ImportedCognitoDomain',
          props.cognitoDomainPrefix
        );
      } else {
        throw new Error('Either cognitoDomain or cognitoDomainPrefix must be provided when using Cognito auth');
      }

      this.listener.addAction('AuthenticateAndForward', {
        priority: 1,
        conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])],
        action: new elbv2Actions.AuthenticateCognitoAction({
          userPool: props.userPool,
          userPoolClient: props.userPoolClient,
          userPoolDomain: userPoolDomain,
          next: elbv2.ListenerAction.forward([this.targetGroup]),
        }),
      });
    } else {
      // No authentication, forward directly
      this.listener.addAction('Forward', {
        priority: 1,
        conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])],
        action: elbv2.ListenerAction.forward([this.targetGroup]),
      });
    }

    // HTTP listener - redirect to HTTPS
    this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });
  }
}
