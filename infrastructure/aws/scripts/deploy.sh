#!/bin/bash
set -e

# OpenChamber AWS Deployment Script
# This script validates configuration and deploys the CDK stack

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=================================================="
echo "  OpenChamber AWS Deployment"
echo "=================================================="

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "ERROR: .env file not found!"
  echo "Please create .env from .env.example and configure your values:"
  echo "  cp .env.example .env"
  exit 1
fi

# Load environment variables
echo "→ Loading environment variables from .env..."
set -a
source "$PROJECT_DIR/.env"
set +a

# Validate required variables
REQUIRED_VARS=("AWS_REGION" "AWS_ACCOUNT" "DOMAIN_NAME")
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "ERROR: Required environment variable $var is not set"
    exit 1
  fi
done

# Validate certificate configuration (either CERTIFICATE_ARN or HOSTED_ZONE_ID required)
if [ -z "$CERTIFICATE_ARN" ] && [ -z "$HOSTED_ZONE_ID" ]; then
  echo "ERROR: Either CERTIFICATE_ARN or HOSTED_ZONE_ID must be set"
  echo "  - HOSTED_ZONE_ID: CDK creates ACM certificate with DNS validation (recommended)"
  echo "  - CERTIFICATE_ARN: Use existing ACM certificate"
  exit 1
fi

echo "→ Configuration:"
echo "   AWS Region:    $AWS_REGION"
echo "   AWS Account:   $AWS_ACCOUNT"
echo "   Domain:        $DOMAIN_NAME"
echo "   Cognito:       ${COGNITO_ENABLED:-true}"
echo "   Fargate CPU:   ${FARGATE_CPU:-4096}"
echo "   Fargate RAM:   ${FARGATE_MEMORY:-8192}"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo "ERROR: AWS CLI is not installed"
  echo "Please install: https://aws.amazon.com/cli/"
  exit 1
fi

# Check AWS credentials
echo "→ Validating AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
  echo "ERROR: AWS credentials not configured or invalid"
  echo "Please run: aws configure"
  exit 1
fi

CALLER_IDENTITY=$(aws sts get-caller-identity)
ACCOUNT_ID=$(echo "$CALLER_IDENTITY" | grep -o '"Account": "[^"]*' | cut -d'"' -f4)

if [ "$ACCOUNT_ID" != "$AWS_ACCOUNT" ]; then
  echo "WARNING: AWS_ACCOUNT in .env ($AWS_ACCOUNT) doesn't match current AWS credentials ($ACCOUNT_ID)"
  read -p "Continue anyway? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed"
  echo "Please install Node.js 20+: https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ is required (found v$NODE_VERSION)"
  exit 1
fi

# Install dependencies if needed
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "→ Installing dependencies..."
  cd "$PROJECT_DIR"
  npm install
fi

# Build TypeScript
echo "→ Building TypeScript..."
cd "$PROJECT_DIR"
npm run build

# Check if CDK is bootstrapped
echo "→ Checking CDK bootstrap status..."
BOOTSTRAP_CHECK=$(aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --region "$AWS_REGION" 2>&1 || echo "not-found")

if [[ "$BOOTSTRAP_CHECK" == *"not-found"* ]] || [[ "$BOOTSTRAP_CHECK" == *"does not exist"* ]]; then
  echo ""
  echo "⚠️  CDK not bootstrapped in this account/region"
  echo "    Running: cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION"
  echo ""
  npx cdk bootstrap "aws://$AWS_ACCOUNT/$AWS_REGION"
fi

# Run CDK deploy
echo ""
echo "→ Deploying CDK stack..."
echo ""

npx cdk deploy --require-approval never

# Display outputs
echo ""
echo "=================================================="
echo "  Deployment Complete!"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Build and push Docker image:"
echo "   ./scripts/build-and-push.sh"
echo ""
echo "2. Force new Fargate deployment:"
echo "   aws ecs update-service \\"
echo "     --cluster openchamber-cluster \\"
echo "     --service openchamber-service \\"
echo "     --force-new-deployment \\"
echo "     --region $AWS_REGION"
echo ""
echo "3. Get ALB DNS name:"
echo "   aws cloudformation describe-stacks \\"
echo "     --stack-name ${STACK_NAME:-OpenchamberStack} \\"
echo "     --query 'Stacks[0].Outputs[?OutputKey==\`ALBDnsName\`].OutputValue' \\"
echo "     --output text \\"
echo "     --region $AWS_REGION"
echo ""
echo "4. Configure DNS CNAME record:"
echo "   $DOMAIN_NAME → <ALB DNS from step 3>"
echo ""
