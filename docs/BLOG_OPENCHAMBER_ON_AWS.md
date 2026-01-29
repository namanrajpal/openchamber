# Self-Host Your AI Coding Agent on AWS: A Complete Guide to OpenChamber

*Deploy a powerful AI coding assistant for your team in under 30 minutes*

---

If you've been using AI coding assistants like Cursor, Cline, or Windsurf, you know how transformative they can be. But what if you want more control? What if you need to run it on your own infrastructure, share it with your team, or integrate it with your company's AWS account for Bedrock access?

Enter **OpenChamber** — an open-source web interface for OpenCode AI agents that you can self-host on AWS. In this guide, I'll walk you through deploying it using AWS CDK, complete with optional authentication, persistent storage, and HTTPS.

## What We're Building

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Route 53 DNS  │
                    │  your-domain   │
                    └────────┬───────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                          AWS VPC                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Public Subnet (Multi-AZ)                    │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  Application Load Balancer                         │  │  │
│  │  │  • HTTPS (443) + ACM Certificate                   │  │  │
│  │  │  • Optional Cognito Authentication                 │  │  │
│  │  └────────────────────┬───────────────────────────────┘  │  │
│  └───────────────────────┼───────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┼───────────────────────────────────┐  │
│  │       Private Subnet (Multi-AZ)                          │  │
│  │       ┌───────────────▼──────────────┐                   │  │
│  │       │   ECS Fargate Service        │                   │  │
│  │       │  ┌────────────────────────┐  │                   │  │
│  │       │  │  OpenChamber Container │  │                   │  │
│  │       │  │  • 4 vCPU / 8GB RAM    │  │                   │  │
│  │       │  │  • OpenCode CLI        │  │                   │  │
│  │       │  │  • Bun Runtime         │  │                   │  │
│  │       │  └──────────┬─────────────┘  │                   │  │
│  │       └─────────────┼────────────────┘                   │  │
│  │                     │                                     │  │
│  │                     ▼                                     │  │
│  │       ┌──────────────────────────┐                       │  │
│  │       │    Amazon EFS            │                       │  │
│  │       │  /workspace (shared)     │                       │  │
│  │       │  • Configs & API keys    │                       │  │
│  │       │  • Project files         │                       │  │
│  │       └──────────────────────────┘                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Optional: AWS Cognito User Pool                         │  │
│  │  • Email/password authentication                         │  │
│  │  • Hosted UI for team login                              │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Key Components:**
- **ECS Fargate** — Serverless containers, no EC2 management
- **EFS** — Persistent storage for configs, API keys, and projects
- **ALB** — HTTPS termination with automatic certificate management
- **Cognito** — Optional team authentication (free tier covers most teams)
- **Bedrock Access** — Built-in IAM permissions for AWS AI models

## Prerequisites

Before we start, make sure you have:

1. **AWS Account** with CLI configured (`aws configure`)
2. **A domain** — Either in Route53 (recommended) or any DNS provider
3. **Local tools:**
   - Node.js 20+
   - Docker Desktop running
   - Git

## Step 1: Clone the Repository

```bash
git clone https://github.com/namanrajpal/openchamber-on-aws.git
cd openchamber-on-aws/infrastructure/aws
```

## Step 2: Configure Your Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Required
AWS_REGION=us-east-1
AWS_ACCOUNT=123456789012  # Your 12-digit account ID
DOMAIN_NAME=openchamber.example.com

# Certificate Mode (choose one):

# Option A: Auto Mode (Recommended if using Route53)
HOSTED_ZONE_ID=Z0123456789ABCDEFGHIJ
HOSTED_ZONE_NAME=example.com

# Option B: Manual Mode (if DNS is elsewhere)
# CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/xxx

# Authentication (optional but recommended)
COGNITO_ENABLED=true

# Git identity for commits made by the agent
GIT_USER_NAME=OpenChamber Bot
GIT_USER_EMAIL=bot@example.com
```

### Finding Your Hosted Zone ID

If your domain is in Route53:

```bash
aws route53 list-hosted-zones \
  --query 'HostedZones[?Name==`example.com.`].Id' \
  --output text
```

The output looks like `/hostedzone/Z0123456789ABCDEFGHIJ` — use just the ID part.

## Step 3: Deploy Infrastructure

```bash
./scripts/deploy.sh
```

This script will:
1. Validate your configuration
2. Install CDK dependencies
3. Bootstrap CDK in your account (first time only)
4. Deploy all AWS resources (~10-15 minutes)

You'll see CloudFormation creating:
- VPC with public/private subnets
- NAT Gateway for outbound traffic
- EFS file system (encrypted)
- ECR repository for Docker images
- ECS cluster and Fargate service
- Application Load Balancer with HTTPS
- Cognito User Pool (if enabled)

## Step 4: Build and Push the Docker Image

```bash
./scripts/build-and-push.sh
```

This builds OpenChamber from source and pushes to your ECR repository. The build takes 3-5 minutes depending on your machine.

## Step 5: Start the Service

```bash
source .env
aws ecs update-service \
  --cluster openchamber-cluster \
  --service openchamber-service \
  --force-new-deployment \
  --region $AWS_REGION
```

Watch the deployment progress:

```bash
aws logs tail /ecs/openchamber --follow --region $AWS_REGION
```

## Step 6: Access Your Instance

If you used Auto Mode (Route53), DNS is already configured. If you used Manual Mode, create a CNAME record pointing your domain to the ALB DNS name:

```bash
# Get the ALB DNS name
aws cloudformation describe-stacks \
  --stack-name OpenchamberStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ALBDnsName`].OutputValue' \
  --output text \
  --region $AWS_REGION
```

Navigate to `https://your-domain.com` — you should see the OpenChamber interface!

## Step 7: Configure AI Providers

1. Go to **Settings → Providers**
2. Add your API keys:
   - **Anthropic** (Claude models) — Get from console.anthropic.com
   - **OpenAI** (GPT models) — Get from platform.openai.com
   - **AWS Bedrock** — Already configured via IAM! Just enable models in AWS Console

Your API keys are stored securely on EFS and persist across container restarts.

## Step 8: Create Your First User (If Using Cognito)

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id-from-outputs> \
  --username your@email.com \
  --user-attributes Name=email,Value=your@email.com \
  --region $AWS_REGION
```

You'll receive a temporary password via email to set up your account.

---

## Cost Breakdown

Here's what to expect for a typical deployment in us-east-1:

| Resource | Monthly Cost |
|----------|--------------|
| NAT Gateway | ~$36 |
| ALB | ~$21 |
| ECS Fargate (4 vCPU, 8GB) | ~$143 |
| EFS (10GB) | ~$4 |
| ECR | ~$1 |
| CloudWatch Logs | ~$3 |
| Cognito | $0 (free tier) |
| **Total** | **~$212/month** |

### Cost Optimization Tips

**For development/testing:**
```bash
# Scale to 0 when not in use
aws ecs update-service \
  --cluster openchamber-cluster \
  --service openchamber-service \
  --desired-count 0 \
  --region $AWS_REGION
```

**Looking for a free tier alternative?** I'm working on a Lambda-based deployment that stays within AWS free tier limits. [Follow GitHub Issue #XXX] for updates.

---

## Common Operations

### Updating OpenChamber

When new versions are released:

```bash
git pull origin main
./scripts/build-and-push.sh
aws ecs update-service \
  --cluster openchamber-cluster \
  --service openchamber-service \
  --force-new-deployment \
  --region $AWS_REGION
```

### Debugging Issues

SSH into the running container:

```bash
TASK_ARN=$(aws ecs list-tasks \
  --cluster openchamber-cluster \
  --service-name openchamber-service \
  --query 'taskArns[0]' \
  --output text \
  --region $AWS_REGION)

aws ecs execute-command \
  --cluster openchamber-cluster \
  --task $TASK_ARN \
  --container openchamber \
  --command "/bin/bash" \
  --interactive \
  --region $AWS_REGION
```

### Adding Team Members

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id> \
  --username newuser@company.com \
  --user-attributes Name=email,Value=newuser@company.com \
  --message-action SUPPRESS \
  --region $AWS_REGION
```

---

## Security Considerations

This deployment follows AWS security best practices:

- ✅ **Fargate in private subnets** — No public IPs on containers
- ✅ **ALB as single entry point** — All traffic through load balancer
- ✅ **EFS encryption at rest** — API keys protected
- ✅ **TLS 1.2+ enforced** — Modern encryption only
- ✅ **Least-privilege security groups** — Only required ports open
- ✅ **Non-root container** — Reduced attack surface
- ✅ **Optional Cognito auth** — Protect access to your instance

## Shared Workspace Model

This deployment uses a shared workspace model — all users share the same EFS volume for:
- OpenCode configurations
- API keys
- Project files
- Chat sessions

This is ideal for **team collaboration** where you want:
- Shared API key management (configure once, use everywhere)
- Shared project context
- Cost efficiency (single Fargate task)

If you need per-user isolation, consider running multiple stacks or implementing user-based routing.

---

## What's Next?

Once deployed, you can:

1. **Use Bedrock models** — Claude, Llama, and more through your AWS account
2. **Create custom agents** — Configure specialized AI assistants
3. **Set up CI/CD** — Automatically deploy updates with GitHub Actions
4. **Monitor usage** — CloudWatch dashboards for cost and performance

## Troubleshooting

**Container won't start?**
- Check logs: `aws logs tail /ecs/openchamber --follow`
- Verify EFS mount succeeded (security group allows NFS from Fargate)

**Health check failures?**
- Verify security group allows ALB → Fargate on port 3000
- Check that OpenChamber started: look for "Server listening" in logs

**Cognito login loops?**
- Verify callback URL matches your domain
- Check ALB listener rules order

---

## Credits

This infrastructure is built for [OpenChamber](https://github.com/btriapitsyn/openchamber), an excellent open-source project providing a web interface for [OpenCode](https://opencode.ai) AI coding agents. Big thanks to the maintainers!

---

*Have questions or improvements? Open an issue on the [GitHub repository](https://github.com/namanrajpal/openchamber-on-aws).*

**Tags:** AWS, CDK, ECS, Fargate, AI, Coding Agents, OpenCode, Self-Hosted, DevOps
