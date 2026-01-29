import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface AuthConstructProps {
  /**
   * Domain name for callback URL configuration
   */
  domainName: string;

  /**
   * ALB DNS name for callback URL
   */
  albDnsName?: string;

  /**
   * Existing Cognito User Pool ID to import
   * If provided, imports the pool instead of creating new
   * @example "us-west-2_hZpW7gd5N"
   */
  existingUserPoolId?: string;

  /**
   * Existing Cognito domain prefix
   * Required when existingUserPoolId is provided
   * @example "transformers-auth"
   */
  existingDomainPrefix?: string;
}

/**
 * Auth construct for OpenChamber
 * Creates or imports Cognito User Pool for authentication
 */
export class AuthConstruct extends Construct {
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.IUserPoolClient;
  public readonly cognitoDomain?: cognito.IUserPoolDomain;
  public readonly cognitoDomainPrefix?: string;

  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    // Mode selection: Import existing pool or create new
    const isImportMode = !!props.existingUserPoolId;

    if (isImportMode) {
      // IMPORT MODE: Use existing User Pool
      this.userPool = cognito.UserPool.fromUserPoolId(
        this,
        'ImportedUserPool',
        props.existingUserPoolId!
      );

      // Store domain prefix for ALB configuration
      this.cognitoDomainPrefix = props.existingDomainPrefix;
      this.cognitoDomain = undefined;

      // Create new App Client in existing pool
      this.userPoolClient = new cognito.UserPoolClient(this, 'OpenchamberUserPoolClient', {
        userPool: this.userPool,
        userPoolClientName: 'openchamber-client',
        generateSecret: true,
        authFlows: {
          userPassword: true,
          userSrp: true,
        },
        oAuth: {
          flows: {
            authorizationCodeGrant: true,
          },
          scopes: [
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.PROFILE,
          ],
          callbackUrls: [
            `https://${props.domainName}/oauth2/idpresponse`,
            ...(props.albDnsName ? [`https://${props.albDnsName}/oauth2/idpresponse`] : []),
          ],
          logoutUrls: [
            `https://${props.domainName}`,
            ...(props.albDnsName ? [`https://${props.albDnsName}`] : []),
          ],
        },
        accessTokenValidity: Duration.hours(1),
        idTokenValidity: Duration.hours(1),
        refreshTokenValidity: Duration.days(30),
      });
    } else {
      // CREATE MODE: Create new User Pool
      this.userPool = new cognito.UserPool(this, 'OpenchamberUserPool', {
      userPoolName: 'openchamber-users',
      selfSignUpEnabled: false, // Admin creates users
      signInAliases: {
        email: true,
        username: false,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN, // Protect user data
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
    });

      // Create Cognito User Pool Client
      this.userPoolClient = new cognito.UserPoolClient(this, 'OpenchamberUserPoolClient', {
        userPool: this.userPool,
        userPoolClientName: 'openchamber-client',
        generateSecret: true,
        authFlows: {
          userPassword: true,
          userSrp: true,
        },
        oAuth: {
          flows: {
            authorizationCodeGrant: true,
          },
          scopes: [
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.PROFILE,
          ],
          callbackUrls: [
            `https://${props.domainName}/oauth2/idpresponse`,
            ...(props.albDnsName ? [`https://${props.albDnsName}/oauth2/idpresponse`] : []),
          ],
          logoutUrls: [
            `https://${props.domainName}`,
            ...(props.albDnsName ? [`https://${props.albDnsName}`] : []),
          ],
        },
        accessTokenValidity: Duration.hours(1),
        idTokenValidity: Duration.hours(1),
        refreshTokenValidity: Duration.days(30),
      });

      // Create Cognito Domain (hosted UI)
      this.cognitoDomain = this.userPool.addDomain('OpenchamberCognitoDomain', {
        cognitoDomain: {
          domainPrefix: `openchamber-${scope.node.addr.substring(0, 8)}`, // Unique prefix
        },
      });
    }
  }
}
