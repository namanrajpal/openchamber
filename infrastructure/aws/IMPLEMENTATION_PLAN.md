# OpenChamber AWS Deployment - Implementation Plan

## Overview

Deploy OpenChamber on AWS ECS Fargate with shared workspace model, optional Cognito authentication, and persistent EFS storage.

**Target Architecture:**
- **Application:** OpenChamber web interface + OpenCode AI agent
- **Compute:** ECS Fargate (single task, 4 vCPU / 8GB RAM)
- **Storage:** EFS (shared workspace for all users)
- **Auth:** AWS Cognito (optional, toggleable via env var)
- **Load Balancer:** ALB with HTTPS (bring your own certificate)
- **Network:** New VPC with public/private subnets, NAT Gateway

---

## Project Structure

```
infrastructure/aws/
├── IMPLEMENTATION_PLAN.md          # This document
├── README.md                       # User-facing deployment guide
├── cdk.json                        # CDK configuration
├── package.json                    # CDK dependencies
├── tsconfig.json                   # TypeScript configuration
├── .gitignore                      # Ignore node_modules, cdk.out, .env
├── .env.example                    # Template for environment variables
│
├── bin/
│   └── app.ts                      # CDK app entry point
│
├── lib/
│   ├── openchamber-stack.ts        # Main stack orchestrator
│   ├── config/
│   │   └── types.ts                # Configuration interfaces
│   └── constructs/
│       ├── network.ts              # VPC, subnets, security groups
│       ├── storage.ts              # EFS file system with access points
│       ├── auth.ts                 # Cognito User Pool (optional)
│       ├── compute.ts              # ECS cluster, Fargate service, ECR
│       └── loadbalancer.ts         # ALB with HTTPS and Cognito integration
│
├── docker/
│   ├── Dockerfile                  # Multi-stage build for OpenChamber
│   └── entrypoint.sh               # Container startup script
│
└── scripts/
    ├── build-and-push.sh           # Build Docker image and push to ECR
    └── deploy.sh                   # Wrapper for CDK deployment
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Route 53 DNS  │ (User managed)
                    │  CNAME Record  │
                    └────────┬───────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                          AWS VPC                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Public Subnet (Multi-AZ)                    │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  Application Load Balancer                         │  │  │
│  │  │  • HTTPS Listener (443) with ACM Certificate       │  │  │
│  │  │  • Cognito Authentication Action (optional)        │  │  │
│  │  │  • Health Check: GET /api/health                   │  │  │
│  │  └────────────────────┬───────────────────────────────┘  │  │
│  └───────────────────────┼───────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┼───────────────────────────────────┐  │
│  │       Private Subnet (Multi-AZ)                          │  │
│  │       ┌───────────────▼──────────────┐                   │  │
│  │       │   ECS Fargate Service        │                   │  │
│  │       │  ┌────────────────────────┐  │                   │  │
│  │       │  │  OpenChamber Task      │  │                   │  │
│  │       │  │  • 4 vCPU / 8GB RAM    │  │                   │  │
│  │       │  │  • Port 3000           │  │                   │  │
│  │       │  │  • Bun Runtime         │  │                   │  │
│  │       │  └──────────┬─────────────┘  │                   │  │
│  │       └─────────────┼────────────────┘                   │  │
│  │                     │                                     │  │
│  │                     ▼                                     │  │
│  │       ┌──────────────────────────┐                       │  │
│  │       │    Amazon EFS            │                       │  │
│  │       │  /workspace (shared)     │                       │  │
│  │       │  • OpenCode configs      │                       │  │
│  │       │  • API keys (auth.json)  │                       │  │
│  │       │  • Project files         │                       │  │
│  │       └──────────────────────────┘                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Optional: Cognito User Pool                             │  │
│  │  • Email/password authentication                         │  │
│  │  • Hosted UI for login                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                    Amazon ECR Repository                          │
│                  openchamber:latest                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Shared Workspace Model

### Design Rationale

All authenticated users share a single workspace on EFS:
- **Collaboration-friendly:** Teams can see and work on the same projects/sessions
- **Simpler architecture:** No per-user context switching required
- **Cost-effective:** Single Fargate task serves all users
- **Admin-managed API keys:** Configure once, used by all team members

### EFS Directory Structure

```
/workspace/                          # Mounted at container $HOME
├── .config/
│   └── opencode/
│       ├── opencode.json           # Provider configs, model settings
│       ├── agents/                 # Custom AI agents
│       ├── commands/               # Custom commands
│       └── skills/                 # Custom skills
│
├── .local/
│   └── share/
│       └── opencode/
│           └── auth.json           # API keys (Anthropic, OpenAI, etc.)
│
├── .gitconfig                      # Shared Git identity
│
└── projects/                       # Working directories
    ├── project-a/
    │   ├── .git/
    │   └── source-code/
    └── project-b/
```

### Security Considerations

| Aspect | Approach |
|--------|----------|
| **Access Control** | Cognito authentication (optional) - only company users |
| **API Keys** | Shared, stored in EFS auth.json, admin-configured |
| **Session Visibility** | All users see all sessions (team collaboration) |
| **Git Identity** | Single shared identity for all commits |
| **Data at Rest** | EFS encrypted with AWS-managed KMS key |
| **Data in Transit** | TLS 1.2+ (ALB → Fargate), NFS over VPC (Fargate → EFS) |

---

## Implementation Phases

### Phase 1: Docker Setup

**Objective:** Create production-ready Docker image for OpenChamber + OpenCode CLI

#### Files to Create

1. **`docker/Dockerfile`**
   - Multi-stage build using `oven/bun:1.3`
   - Build stage: Install deps + build OpenChamber web package
   - Runtime stage: `oven/bun:1.3-slim` base
   - Install OpenCode CLI via official installer
   - Copy built artifacts
   - Install production dependencies only
   - Expose port 3000

2. **`docker/entrypoint.sh`**
   - Set `$HOME=/workspace` (EFS mount point)
   - Create OpenCode config directories
   - Configure shared Git identity (if not exists)
   - Start OpenChamber via `openchamber` CLI

#### Build & Test Locally

```bash
# Build image
docker build -t openchamber:local -f infrastructure/aws/docker/Dockerfile .

# Test run (without EFS)
docker run -p 3000:3000 \
  -e GIT_USER_NAME="Test Bot" \
  -e GIT_USER_EMAIL="test@example.com" \
  openchamber:local

# Access at http://localhost:3000
```

**Expected Result:** OpenChamber starts, you can configure API keys via UI, create sessions.

---

### Phase 2: CDK Infrastructure - Network

**Objective:** Create VPC with public/private subnets, NAT Gateway, security groups

#### Files to Create

1. **`lib/constructs/network.ts`**
   - Create VPC with 2 availability zones
   - Public subnets for ALB (with internet gateway)
   - Private subnets for Fargate (with NAT gateway)
   - Security Groups:
     - `albSecurityGroup`: Allow 443 inbound from anywhere
     - `fargateSecurityGroup`: Allow 3000 from ALB only
     - `efsSecurityGroup`: Allow NFS (2049) from Fargate only

#### Exports from Construct

```typescript
export class NetworkConstruct {
  public readonly vpc: ec2.IVpc;
  public readonly albSecurityGroup: ec2.ISecurityGroup;
  public readonly fargateSecurityGroup: ec2.ISecurityGroup;
  public readonly efsSecurityGroup: ec2.ISecurityGroup;
}
```

---

### Phase 3: CDK Infrastructure - Storage

**Objective:** Create encrypted EFS file system for shared workspace

#### Files to Create

1. **`lib/constructs/storage.ts`**
   - Create EFS file system with encryption at rest
   - Enable automatic backups
   - Create access point for `/workspace` directory
   - Configure lifecycle policy (transition to IA after 30 days)
   - Create mount targets in private subnets

#### Exports from Construct

```typescript
export class StorageConstruct {
  public readonly fileSystem: efs.IFileSystem;
  public readonly accessPoint: efs.IAccessPoint;
}
```

---

### Phase 4: CDK Infrastructure - Auth (Optional)

**Objective:** Create Cognito User Pool for authentication

#### Files to Create

1. **`lib/constructs/auth.ts`**
   - Conditionally create User Pool based on `COGNITO_ENABLED` env var
   - Email-based sign-in
   - Password policy: min 8 chars, require uppercase, lowercase, numbers
   - Email verification required
   - Create App Client with OAuth 2.0 authorization code flow
   - Create Cognito domain (hosted UI)
   - Configure callback URLs (ALB DNS + custom domain)

#### Exports from Construct

```typescript
export class AuthConstruct {
  public readonly userPool?: cognito.IUserPool;
  public readonly userPoolClient?: cognito.IUserPoolClient;
  public readonly cognitoDomain?: cognito.IUserPoolDomain;
}
```

---

### Phase 5: CDK Infrastructure - Compute

**Objective:** Create ECR repository, ECS cluster, Fargate task/service

#### Files to Create

1. **`lib/constructs/compute.ts`**
   - Create ECR repository with lifecycle policy (keep last 5 images)
   - Create ECS cluster
   - Create Fargate Task Definition:
     - 4096 CPU units (4 vCPU)
     - 8192 MB memory
     - EFS volume mount at `/workspace`
     - Container definition:
       - Image from ECR
       - Port 3000
       - Environment variables: `HOME=/workspace`, `GIT_USER_*`
       - CloudWatch log group
     - Task execution role (pull from ECR, write logs)
     - Task role (access EFS)
   - Create Fargate Service:
     - Desired count: 1
     - Platform version: LATEST
     - Enable execute command (for debugging)
     - Health check grace period: 60s
     - Deployment configuration: rolling update

#### Exports from Construct

```typescript
export class ComputeConstruct {
  public readonly repository: ecr.IRepository;
  public readonly cluster: ecs.ICluster;
  public readonly service: ecs.IFargateService;
  public readonly taskDefinition: ecs.IFargateTaskDefinition;
}
```

---

### Phase 6: CDK Infrastructure - Load Balancer

**Objective:** Create ALB with HTTPS listener and Cognito integration

#### Files to Create

1. **`lib/constructs/loadbalancer.ts`**
   - Create Application Load Balancer in public subnets
   - HTTPS listener (443):
     - Certificate from provided ARN
     - If Cognito enabled: Add authenticate action
     - Forward to Fargate target group
   - HTTP listener (80): Redirect to HTTPS
   - Target group for Fargate service:
     - Protocol: HTTP
     - Port: 3000
     - Health check: `/api/health`, 30s interval
     - Deregistration delay: 30s

#### Exports from Construct

```typescript
export class LoadBalancerConstruct {
  public readonly alb: elbv2.IApplicationLoadBalancer;
  public readonly listener: elbv2.IApplicationListener;
  public readonly targetGroup: elbv2.IApplicationTargetGroup;
}
```

---

### Phase 7: CDK Main Stack

**Objective:** Orchestrate all constructs into single deployable stack

#### Files to Create

1. **`lib/openchamber-stack.ts`**
   - Read configuration from environment variables
   - Instantiate constructs in dependency order:
     1. Network
     2. Storage
     3. Auth (if enabled)
     4. Compute
     5. Load Balancer
   - Wire dependencies between constructs
   - Output stack values (ALB DNS, ECR URI, etc.)

2. **`bin/app.ts`**
   - CDK app entry point
   - Instantiate `OpenchamberStack`
   - Configure stack properties (env, tags)

3. **`lib/config/types.ts`**
   - TypeScript interfaces for configuration
   - Environment variable schema

---

### Phase 8: Configuration & Scripts

**Objective:** Provide deployment scripts and configuration templates

#### Files to Create

1. **`.env.example`**
   ```bash
   # Required
   DOMAIN_NAME=openchamber.yourcompany.com
   CERTIFICATE_ARN=arn:aws:acm:us-east-1:xxxxx:certificate/xxxxx
   
   # Optional
   COGNITO_ENABLED=true
   GIT_USER_NAME=OpenChamber Bot
   GIT_USER_EMAIL=openchamber@company.com
   FARGATE_CPU=4096
   FARGATE_MEMORY=8192
   AWS_REGION=us-east-1
   AWS_ACCOUNT=123456789012
   ```

2. **`scripts/build-and-push.sh`**
   - Get ECR repository URI from CloudFormation outputs
   - Build Docker image from repository root
   - Authenticate to ECR
   - Tag and push image

3. **`scripts/deploy.sh`**
   - Source `.env` file
   - Validate required environment variables
   - Run `npm run build` (compile TypeScript)
   - Run `npx cdk deploy`

4. **`package.json`**
   - CDK dependencies
   - AWS CDK Construct Library packages
   - Scripts for build, synth, deploy, diff

5. **`tsconfig.json`**
   - TypeScript compiler options
   - Strict mode enabled
   - Target ES2020

6. **`cdk.json`**
   - CDK toolkit configuration
   - App command: `npx ts-node bin/app.ts`
   - Context values

7. **`.gitignore`**
   - `node_modules/`
   - `cdk.out/`
   - `.env`
   - `*.js`, `*.d.ts` (generated files)

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DOMAIN_NAME` | Yes | - | Your domain (e.g., `openchamber.company.com`) |
| `CERTIFICATE_ARN` | Yes | - | ACM certificate ARN for HTTPS |
| `AWS_REGION` | Yes | - | AWS region for deployment |
| `AWS_ACCOUNT` | Yes | - | AWS account ID |
| `COGNITO_ENABLED` | No | `true` | Enable Cognito authentication |
| `GIT_USER_NAME` | No | `OpenChamber Bot` | Git commit author name |
| `GIT_USER_EMAIL` | No | `openchamber@company.com` | Git commit author email |
| `FARGATE_CPU` | No | `4096` | Fargate task CPU units (1024, 2048, 4096, 8192) |
| `FARGATE_MEMORY` | No | `8192` | Fargate task memory in MB |

---

## Deployment Workflow

### Prerequisites

1. **AWS Account Setup**
   - AWS CLI configured with credentials
   - IAM permissions for: VPC, ECS, EFS, Cognito, ECR, ALB, CloudWatch
   - ACM certificate created and validated for your domain

2. **Local Development Environment**
   - Node.js 20+ installed
   - Docker installed and running
   - Bun installed (for building OpenChamber)

### Initial Deployment

```bash
# 1. Navigate to infrastructure directory
cd infrastructure/aws

# 2. Install CDK dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your values

# 4. Bootstrap CDK (first time only)
source .env
npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION

# 5. Deploy infrastructure
./scripts/deploy.sh

# 6. Build and push Docker image
./scripts/build-and-push.sh

# 7. Force new Fargate deployment
aws ecs update-service \
  --cluster OpenchamberCluster \
  --service OpenchamberService \
  --force-new-deployment \
  --region $AWS_REGION

# 8. Configure DNS
# Create CNAME record: DOMAIN_NAME → ALB DNS (from stack outputs)

# 9. Access application
# Visit https://openchamber.yourcompany.com
# If Cognito enabled, create first user in AWS Console
```

### Subsequent Deployments

**Infrastructure changes:**
```bash
./scripts/deploy.sh
```

**Application changes (code updates):**
```bash
./scripts/build-and-push.sh
aws ecs update-service \
  --cluster OpenchamberCluster \
  --service OpenchamberService \
  --force-new-deployment
```

---

## Post-Deployment Configuration

### First-Time Setup (via OpenChamber UI)

1. **Access the application**
   - Navigate to `https://openchamber.yourcompany.com`
   - Login via Cognito (if enabled)

2. **Configure API Keys**
   - Go to Settings → Providers
   - Add API keys for:
     - Anthropic (Claude models)
     - OpenAI (GPT models)
     - Other providers as needed
   - Keys are saved to `/workspace/.local/share/opencode/auth.json` on EFS

3. **Verify Git Configuration**
   - Create a test session
   - Make a commit via OpenCode
   - Verify commit author matches configured Git identity

### Admin Tasks

**View container logs:**
```bash
aws logs tail /ecs/openchamber --follow
```

**Execute command in container (debugging):**
```bash
aws ecs execute-command \
  --cluster OpenchamberCluster \
  --task <task-id> \
  --container openchamber \
  --command "/bin/bash" \
  --interactive
```

**Access EFS files:**
- Mount EFS on EC2 instance in same VPC
- Or use ECS Exec to access from running container

**Add Cognito user:**
```bash
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id> \
  --username user@company.com \
  --user-attributes Name=email,Value=user@company.com \
  --message-action SUPPRESS
```

---

## Cost Estimation

### Monthly Costs (us-east-1, shared workspace model)

| Resource | Configuration | Monthly Cost |
|----------|--------------|--------------|
| **VPC** | 2 AZs, public/private subnets | Free |
| **NAT Gateway** | 1 NAT Gateway + data transfer (~100GB) | $32 + $4.50 = ~$36.50 |
| **ALB** | Always-on + 1 LCU average | $16.20 + ~$5 = ~$21 |
| **EFS** | 10GB storage + minimal access | $3 + ~$1 = ~$4 |
| **ECS Fargate** | 4 vCPU, 8GB RAM, 730 hrs/month | $142.56 |
| **ECR** | 5 images @ 2GB each | $1 |
| **Cognito** | Free tier (up to 50K MAUs) | $0 |
| **CloudWatch Logs** | ~5GB/month | $2.50 |
| **Data Transfer** | Outbound to internet (~50GB) | $4.50 |
| **Total** | | **~$212/month** |

### Cost Optimization Tips

1. **Development Environment:**
   - Set desired count to 0 when not in use
   - Disable NAT Gateway (use public subnets for testing only)
   - Use Fargate Spot for dev: ~70% cost savings

2. **Production Optimization:**
   - Use EFS Infrequent Access for old files
   - Enable ALB access log sampling (10% instead of 100%)
   - Use S3 lifecycle policies for old container logs

3. **Scaling Considerations:**
   - Current design: 1 task = ~5-10 concurrent users
   - For more users: Increase task count (costs scale linearly)
   - For high availability: Enable multi-AZ deployment (2x task cost)

---

## Troubleshooting Guide

### Container Fails to Start

**Symptoms:** Task stops immediately after starting

**Checks:**
1. View logs: `aws logs tail /ecs/openchamber --follow`
2. Check OpenCode CLI installation succeeded
3. Verify EFS mount succeeded
4. Check environment variables are set correctly

**Common Causes:**
- OpenCode CLI install script failed (network issue)
- EFS mount timeout (security group misconfigured)
- Missing required environment variables

### Health Check Failures

**Symptoms:** ALB marks targets unhealthy, task restarts

**Checks:**
1. Verify `/api/health` endpoint responds: `curl http://localhost:3000/api/health` from inside container
2. Check Fargate security group allows traffic from ALB
3. Review health check configuration (timeout, interval, healthy threshold)

**Common Causes:**
- OpenChamber not bound to `0.0.0.0` (listening on localhost only)
- Health check timeout too short for cold start
- OpenCode server failed to start

### Cognito Authentication Loop

**Symptoms:** Redirects to Cognito repeatedly, never reaches app

**Checks:**
1. Verify callback URL in Cognito App Client matches ALB DNS name
2. Check ALB listener rules order (auth action must be before forward)
3. Review Cognito CloudWatch logs for errors

**Common Causes:**
- Callback URL mismatch
- Session cookie domain mismatch
- Cognito domain not configured

### EFS Mount Failures

**Symptoms:** Container logs show "mount.nfs: Connection timed out"

**Checks:**
1. Verify EFS security group allows NFS (2049) from Fargate security group
2. Check EFS mount targets exist in all Fargate subnets
3. Verify EFS file system is available

**Common Causes:**
- Missing security group ingress rule
- Mount target not in task subnet
- EFS file system deleted

---

## Security Best Practices

### Network Security

- ✅ Fargate tasks in private subnets (no public IP)
- ✅ ALB as only public entry point
- ✅ Security groups follow least-privilege (only required ports)
- ✅ VPC Flow Logs enabled (optional, add via CDK if needed)

### Data Security

- ✅ EFS encryption at rest with AWS-managed keys
- ✅ TLS 1.2+ enforced on ALB
- ✅ Sensitive data (API keys) stored on encrypted EFS
- ✅ Container runs as non-root user (TODO: add to Dockerfile)

### Access Control

- ✅ Cognito for user authentication (optional but recommended)
- ✅ IAM roles follow least-privilege
- ✅ ECR image scanning enabled (detect vulnerabilities)
- ✅ CloudWatch logs retention configured (30 days recommended)

### Operational Security

- ✅ Enable AWS CloudTrail for API audit logging
- ✅ Tag all resources for cost tracking and governance
- ✅ Use AWS Secrets Manager for sensitive env vars (future enhancement)
- ✅ Implement backup strategy for EFS (automated backups enabled)

---

## Future Enhancements

### High Availability

- [ ] Deploy tasks across multiple AZs
- [ ] Increase desired count to 2+ with proper session affinity
- [ ] Configure ALB cross-zone load balancing

### Monitoring & Observability

- [ ] CloudWatch dashboard with key metrics (CPU, memory, request count)
- [ ] CloudWatch alarms for unhealthy targets, high error rates
- [ ] X-Ray tracing for distributed tracing
- [ ] Container Insights for enhanced ECS metrics

### Security Hardening

- [ ] Run container as non-root user
- [ ] Implement read-only root filesystem (requires writable volumes for EFS)
- [ ] Use Secrets Manager for API keys instead of EFS
- [ ] Enable GuardDuty for threat detection
- [ ] Implement AWS WAF for ALB (rate limiting, OWASP rules)

### DevOps Improvements

- [ ] Add CI/CD pipeline (GitHub Actions or CodePipeline)
- [ ] Implement blue/green deployments
- [ ] Add infrastructure testing (CDK assertions)
- [ ] Automate certificate renewal reminders

### Per-User Isolation (Alternative Architecture)

If team collaboration model doesn't work:
- [ ] Implement sidecar proxy to read JWT and set user context
- [ ] Create per-user EFS access points
- [ ] Modify entrypoint to support dynamic HOME directory
- [ ] Update OpenCode server to isolate sessions by user

---

## References

### Documentation

- [OpenChamber README](../../README.md)
- [OpenChamber AGENTS.md](../../AGENTS.md)
- [AWS CDK TypeScript Reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-construct-library.html)
- [ECS Fargate Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
- [OpenCode Documentation](https://opencode.ai/docs)

### External Resources

- [Bun Docker Images](https://hub.docker.com/r/oven/bun/tags)
- [AWS EFS Performance](https://docs.aws.amazon.com/efs/latest/ug/performance.html)
- [Cognito + ALB Integration](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html)

---

## Implementation Checklist

### Phase 1: Docker ✅
- [ ] Create `docker/Dockerfile`
- [ ] Create `docker/entrypoint.sh`
- [ ] Test build locally
- [ ] Test run locally (without EFS)

### Phase 2: CDK Network ✅
- [ ] Create `lib/constructs/network.ts`
- [ ] Create `lib/config/types.ts`
- [ ] Test synth (no deployment)

### Phase 3: CDK Storage ✅
- [ ] Create `lib/constructs/storage.ts`
- [ ] Test synth

### Phase 4: CDK Auth ✅
- [ ] Create `lib/constructs/auth.ts`
- [ ] Test synth with `COGNITO_ENABLED=true`
- [ ] Test synth with `COGNITO_ENABLED=false`

### Phase 5: CDK Compute ✅
- [ ] Create `lib/constructs/compute.ts`
- [ ] Test synth

### Phase 6: CDK Load Balancer ✅
- [ ] Create `lib/constructs/loadbalancer.ts`
- [ ] Test synth

### Phase 7: CDK Main Stack ✅
- [ ] Create `lib/openchamber-stack.ts`
- [ ] Create `bin/app.ts`
- [ ] Test synth full stack

### Phase 8: Configuration & Scripts ✅
- [ ] Create `.env.example`
- [ ] Create `package.json`
- [ ] Create `tsconfig.json`
- [ ] Create `cdk.json`
- [ ] Create `.gitignore`
- [ ] Create `scripts/deploy.sh`
- [ ] Create `scripts/build-and-push.sh`
- [ ] Create `README.md` (user guide)

### Phase 9: Testing & Deployment ✅
- [ ] Bootstrap CDK in target AWS account
- [ ] Deploy stack to dev/test environment
- [ ] Build and push Docker image
- [ ] Force Fargate deployment
- [ ] Configure DNS
- [ ] Test end-to-end (login, configure API keys, run agent)
- [ ] Document deployment process
- [ ] Create troubleshooting runbook

---

## Success Criteria

### Infrastructure
- ✅ CDK stack deploys without errors
- ✅ All resources created in correct VPC/subnets
- ✅ Security groups configured correctly
- ✅ EFS accessible from Fargate tasks

### Application
- ✅ Docker image builds successfully
- ✅ Container starts and stays healthy
- ✅ OpenChamber UI accessible via HTTPS
- ✅ Cognito authentication works (if enabled)
- ✅ OpenCode CLI functional inside container
- ✅ API keys persist across container restarts

### Operational
- ✅ Health checks pass consistently
- ✅ Logs available in CloudWatch
- ✅ Can execute commands in running container
- ✅ EFS files accessible and persisted
- ✅ Total cost within budget (~$212/month)

---

**Document Version:** 1.0  
**Last Updated:** January 23, 2026  
**Author:** Implementation Team  
**Status:** Ready for Implementation
