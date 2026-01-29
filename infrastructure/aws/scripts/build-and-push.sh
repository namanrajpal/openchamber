#!/bin/bash
set -e

# OpenChamber Docker Build and Push Script
# This script builds the Docker image and pushes it to ECR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$PROJECT_DIR")")"

echo "=================================================="
echo "  OpenChamber Docker Build & Push"
echo "=================================================="

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "ERROR: .env file not found!"
  echo "Please create .env from .env.example and configure your values"
  exit 1
fi

# Load environment variables
echo "→ Loading environment variables from .env..."
set -a
source "$PROJECT_DIR/.env"
set +a

STACK_NAME="${STACK_NAME:-OpenchamberStack}"

# Check if Docker is running
if ! docker info &> /dev/null; then
  echo "ERROR: Docker is not running"
  echo "Please start Docker and try again"
  exit 1
fi

# Get ECR repository URI from CloudFormation outputs
echo "→ Getting ECR repository URI from CloudFormation..."
ECR_URI=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`ECRRepositoryUri`].OutputValue' \
  --output text \
  --region "$AWS_REGION" 2>&1)

if [ -z "$ECR_URI" ] || [[ "$ECR_URI" == *"does not exist"* ]] || [[ "$ECR_URI" == "None" ]]; then
  echo "ERROR: Could not get ECR repository URI"
  echo "Make sure the CDK stack is deployed:"
  echo "  cd infrastructure/aws && ./scripts/deploy.sh"
  exit 1
fi

echo "   ECR Repository: $ECR_URI"

# Build Docker image
echo ""
echo "→ Building Docker image..."
echo "   Context: $REPO_ROOT"
echo "   Dockerfile: infrastructure/aws/docker/Dockerfile"
echo ""

docker build \
  --platform linux/amd64 \
  -t openchamber:latest \
  -f "$PROJECT_DIR/docker/Dockerfile" \
  "$REPO_ROOT"

# Tag for ECR
echo ""
echo "→ Tagging image for ECR..."
docker tag openchamber:latest "$ECR_URI:latest"

# Login to ECR
echo ""
echo "→ Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_URI"

# Push to ECR
echo ""
echo "→ Pushing image to ECR..."
docker push "$ECR_URI:latest"

echo ""
echo "=================================================="
echo "  Docker Image Pushed Successfully!"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Force new Fargate deployment:"
echo "   aws ecs update-service \\"
echo "     --cluster openchamber-cluster \\"
echo "     --service openchamber-service \\"
echo "     --force-new-deployment \\"
echo "     --region $AWS_REGION"
echo ""
echo "2. Monitor deployment:"
echo "   aws ecs describe-services \\"
echo "     --cluster openchamber-cluster \\"
echo "     --services openchamber-service \\"
echo "     --region $AWS_REGION"
echo ""
echo "3. View logs:"
echo "   aws logs tail /ecs/openchamber --follow --region $AWS_REGION"
echo ""
