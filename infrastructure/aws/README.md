# OpenChamber AWS Infrastructure

Deploy OpenChamber on AWS using ECS Fargate with shared workspace model.

## Architecture

- **Compute:** ECS Fargate (4 vCPU / 8GB RAM)
- **Storage:** EFS (shared workspace for team collaboration)
- **Auth:** AWS Cognito (optional, toggleable)
- **Load Balancer:** ALB with HTTPS
- **Network:** VPC with public/private subnets, NAT Gateway

**Estimated Cost:** ~$212/month (us-west-2)

## Prerequisites

1. **AWS Account & CLI**
   - AWS CLI installed and configured
   - IAM permissions for: VPC, ECS, EFS, Cognito, ECR, ALB, CloudWatch

2. **Domain & Certificate** (choose one mode)
   - **Auto Mode (Recommended):** Route53 Hosted Zone for your domain
   - **Manual Mode:** Pre-created ACM certificate and DNS access

3. **Local Tools**
   - Node.js 20+
   - Docker installed and running
   - Bun (for building OpenChamber)

## Quick Start

### 1. Configure Environment

```bash
cd infrastructure/aws
cp .env.example .env
# Edit .env with your values
```

Required variables:
- `AWS_REGION` - AWS region (e.g., `us-east-1`)
- `AWS_ACCOUNT` - AWS account ID
- `DOMAIN_NAME` - Your domain (e.g., `openchamber.company.com`)

**Certificate Configuration (choose ONE mode):**

**Mode 1: Auto Certificate & DNS (Recommended)**
- `HOSTED_ZONE_ID` - Route53 Hosted Zone ID (e.g., `Z0123456789ABCDEFGHIJ`)
- `HOSTED_ZONE_NAME` - Hosted Zone name (e.g., `opencode.company.dev`)

CDK will automatically:
- Create ACM certificate with DNS validation
- Create Route53 A record pointing to ALB
- No manual DNS configuration needed

**Mode 2: Manual Certificate (Legacy)**
- `CERTIFICATE_ARN` - Pre-created ACM certificate ARN
- You must manually create DNS CNAME record (see step 5)

Optional variables:
- `COGNITO_ENABLED` - Enable Cognito auth (default: `true`)
- `COGNITO_USER_POOL_ID` - Existing User Pool ID (e.g., `us-west-2_hZpW7gd5N`)
- `COGNITO_DOMAIN_PREFIX` - Existing domain prefix (e.g., `transformers-auth`)
- `GIT_USER_NAME` - Git commit author (default: `OpenChamber Bot`)
- `GIT_USER_EMAIL` - Git commit email
- `FARGATE_CPU` - CPU units (default: `4096`)
- `FARGATE_MEMORY` - Memory in MB (default: `8192`)

**Note:** If `COGNITO_USER_POOL_ID` is provided, CDK will import your existing User Pool instead of creating a new one. See [Using Existing User Pool](#using-existing-cognito-user-pool) below.

### 2. Deploy Infrastructure

```bash
./scripts/deploy.sh
```

This will:
- Validate configuration
- Install CDK dependencies
- Build TypeScript
- Bootstrap CDK (if needed)
- Deploy all AWS resources

### 3. Build & Push Docker Image

```bash
./scripts/build-and-push.sh
```

This builds OpenChamber from source and pushes to ECR.

### 4. Deploy Container

```bash
source .env
aws ecs update-service \
  --cluster openchamber-cluster \
  --service openchamber-service \
  --force-new-deployment \
  --region $AWS_REGION
```

### 5. Configure DNS

**If using Auto Mode (HOSTED_ZONE_ID):** DNS is configured automatically. Skip this step.

**If using Manual Mode (CERTIFICATE_ARN):** Create DNS record manually:

Get ALB DNS name:
```bash
aws cloudformation describe-stacks \
  --stack-name OpenchamberStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ALBDnsName`].OutputValue' \
  --output text \
  --region $AWS_REGION
```

Create CNAME record: `your-domain.com` → `<ALB-DNS-name>`

### 6. Access Application

Visit `https://your-domain.com`

If Cognito is enabled, create first user:
```bash
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id> \
  --username user@company.com \
  --user-attributes Name=email,Value=user@company.com \
  --region $AWS_REGION
```

## Using Existing Cognito User Pool

If your organization already has a Cognito User Pool with users configured, you can use it instead of creating a new one.

### Prerequisites

1. **User Pool ID:** Find it in AWS Console → Cognito → User Pools → Select Pool → User pool ID
2. **Domain Prefix:** AWS Console → Cognito → User Pools → Select Pool → App Integration → Domain
   - Use just the prefix (e.g., `transformers-auth` from `transformers-auth.auth.us-west-2.amazoncognito.com`)

### Configuration

Add to your `.env` file:

```bash
COGNITO_ENABLED=true
COGNITO_USER_POOL_ID=us-west-2_hZpW7gd5N
COGNITO_DOMAIN_PREFIX=transformers-auth
```

### What CDK Will Do

When you provide an existing User Pool ID:

1. ✅ **Import** your existing User Pool (not create a new one)
2. ✅ **Create** a new App Client named "openchamber-client" in your pool
3. ✅ **Configure** callback URLs for your domain
4. ✅ **Reference** your existing Cognito domain (not create a new one)

### Benefits

- **Existing users** can log in immediately (no migration needed)
- **Centralized user management** - manage users in your existing pool
- **Consistent authentication** across your organization's applications

### Note

The App Client will be created with:
- **OAuth 2.0:** Authorization code grant flow
- **Scopes:** email, openid, profile
- **Callback URL:** `https://your-domain.com/oauth2/idpresponse`
- **Client Secret:** Generated (required for ALB authentication)

## Certificate & DNS Configuration

OpenChamber supports two modes for HTTPS setup: **Auto Mode** (recommended) and **Manual Mode**.

### Auto Mode (Recommended)

CDK automatically creates an ACM certificate and configures DNS using your Route53 Hosted Zone.

**Prerequisites:**
- Route53 Hosted Zone for your domain (e.g., `example.com`)

**Configuration:**
```bash
# In .env file
DOMAIN_NAME=openchamber.example.com
HOSTED_ZONE_ID=Z0123456789ABCDEFGHIJ
HOSTED_ZONE_NAME=example.com
```

**Find your Hosted Zone ID:**
```bash
aws route53 list-hosted-zones --query 'HostedZones[?Name==`example.com.`].Id' --output text
```

**What CDK Does Automatically:**
1. ✅ Creates ACM certificate for your domain
2. ✅ Validates certificate using DNS (adds validation records)
3. ✅ Creates Route53 A record pointing to ALB
4. ✅ No manual DNS configuration needed

**Benefits:**
- Fully automated setup
- No manual DNS records to create
- Certificate auto-renews via DNS validation
- Follows AWS best practices

### Manual Mode (Legacy)

You provide a pre-created ACM certificate and manually configure DNS.

**Prerequisites:**
- ACM certificate created and validated in target region
- DNS access to create CNAME records

**Configuration:**
```bash
# In .env file
DOMAIN_NAME=openchamber.yourcompany.com
CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/xxx
```

**What You Must Do Manually:**
1. Create ACM certificate in AWS Console
2. Validate certificate (DNS or email)
3. After deployment, create DNS CNAME: `openchamber.yourcompany.com` → `<ALB-DNS-name>` (from CloudFormation outputs)

**When to Use:**
- You already have a certificate you want to reuse
- Your DNS is not in Route53
- You need manual control over DNS records

---

## Post-Deployment Configuration

### Add API Keys

1. Login to OpenChamber UI
2. Go to **Settings → Providers**
3. Add API keys for:
   - Anthropic (Claude)
   - OpenAI (GPT)
   - Other providers as needed
4. Keys are automatically saved to EFS

### Verify Setup

```bash
# View logs
aws logs tail /ecs/openchamber --follow --region $AWS_REGION

# Check service status
aws ecs describe-services \
  --cluster openchamber-cluster \
  --services openchamber-service \
  --region $AWS_REGION
```

## Common Operations

### Update Application Code

```bash
./scripts/build-and-push.sh
aws ecs update-service \
  --cluster openchamber-cluster \
  --service openchamber-service \
  --force-new-deployment \
  --region $AWS_REGION
```

### Update Infrastructure

```bash
# Modify CDK code in lib/
./scripts/deploy.sh
```

### Access Container Shell

```bash
# Get task ARN
TASK_ARN=$(aws ecs list-tasks \
  --cluster openchamber-cluster \
  --service-name openchamber-service \
  --query 'taskArns[0]' \
  --output text \
  --region $AWS_REGION)

# Execute command
aws ecs execute-command \
  --cluster openchamber-cluster \
  --task $TASK_ARN \
  --container openchamber \
  --command "/bin/bash" \
  --interactive \
  --region $AWS_REGION
```

### Add Cognito User

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id> \
  --username newuser@company.com \
  --user-attributes Name=email,Value=newuser@company.com \
  --message-action SUPPRESS \
  --region $AWS_REGION
```

### View All Outputs

```bash
aws cloudformation describe-stacks \
  --stack-name OpenchamberStack \
  --query 'Stacks[0].Outputs' \
  --region $AWS_REGION
```

## Troubleshooting

### Container Won't Start

Check logs:
```bash
aws logs tail /ecs/openchamber --follow --region $AWS_REGION
```

Common issues:
- OpenCode CLI installation failed
- EFS mount timeout (check security groups)
- Missing environment variables

### Health Check Failures

Verify endpoint inside container:
```bash
# From ECS Exec shell
curl http://localhost:3000/api/health
```

Check:
- Fargate security group allows traffic from ALB
- Health check timeout is sufficient (30s)
- OpenChamber started successfully

### Cognito Authentication Loop

Verify:
- Callback URLs in Cognito match ALB DNS
- ALB listener rules are in correct order
- Cognito domain is configured

## Cost Optimization

### Development Environment

```bash
# Scale down to 0 when not in use
aws ecs update-service \
  --cluster openchamber-cluster \
  --service openchamber-service \
  --desired-count 0 \
  --region $AWS_REGION

# Scale back up
aws ecs update-service \
  --cluster openchamber-cluster \
  --service openchamber-service \
  --desired-count 1 \
  --region $AWS_REGION
```

### Production Optimization

- Use EFS Infrequent Access for old files
- Enable ALB access log sampling
- Use S3 lifecycle policies for old logs

## Stack Deletion

**WARNING:** This will delete all resources including EFS data (if retention policy allows).

```bash
# Delete stack
npx cdk destroy

# Manually delete:
# - EFS file system (if retained)
# - ECR images
# - CloudWatch log groups
```

## Architecture Details

### Shared Workspace Model

All users share a single workspace on EFS:

```
/workspace/                      # EFS mount
├── .config/opencode/           # OpenCode configuration
│   ├── opencode.json           # Provider settings
│   ├── agents/                 # Custom agents
│   ├── commands/               # Custom commands
│   └── skills/                 # Custom skills
├── .local/share/opencode/      
│   └── auth.json               # API keys (shared)
├── .gitconfig                  # Shared Git identity
└── projects/                   # Working directories
```

**Benefits:**
- Team collaboration (shared sessions)
- Single set of API keys
- Cost-effective (one Fargate task)

**Considerations:**
- All users see all sessions
- Shared Git identity for commits
- No per-user isolation

### Security

- ✅ Fargate tasks in private subnets (no public IP)
- ✅ ALB as only public entry point
- ✅ EFS encrypted at rest
- ✅ TLS 1.2+ enforced on ALB
- ✅ Security groups follow least-privilege
- ✅ Container runs as non-root user
- ✅ Cognito authentication (optional)

### High Availability

Current setup: Single Fargate task (~5-10 concurrent users)

For HA:
- Increase desired count to 2+
- Enable cross-zone load balancing
- Deploy across multiple AZs

## Resources

- [Implementation Plan](./IMPLEMENTATION_PLAN.md) - Detailed architecture and planning
- [OpenChamber Documentation](../../README.md)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [OpenCode Documentation](https://opencode.ai/docs)

## Support

For issues with:
- **OpenChamber:** [GitHub Issues](https://github.com/btriapitsyn/openchamber/issues)
- **This Infrastructure:** Create issue in your fork
- **AWS Services:** [AWS Support](https://aws.amazon.com/support/)

## Credits

This AWS infrastructure is designed for [OpenChamber](https://github.com/btriapitsyn/openchamber), an open-source web interface for [OpenCode](https://opencode.ai) AI coding agents. Special thanks to the OpenChamber maintainers for creating this excellent tool.

## License

MIT (same as OpenChamber)
