#!/bin/bash
set -e

echo "==================================================="
echo "  OpenChamber Container Starting"
echo "==================================================="

# Shared workspace on EFS (mounted by ECS)
export HOME=/workspace

echo "→ Setting HOME to: $HOME"

# Ensure OpenCode config directories exist
echo "→ Creating OpenCode configuration directories..."
mkdir -p "$HOME/.config/opencode"
mkdir -p "$HOME/.local/share/opencode"

# Create OpenCode config with sharing disabled (for enterprise/security)
if [ ! -f "$HOME/.config/opencode/opencode.json" ]; then
  echo "→ Creating OpenCode config (sharing disabled)..."
  cat > "$HOME/.config/opencode/opencode.json" << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "share": "disabled"
}
EOF
fi

# Ensure repos directory exists (may be volume-mounted, overriding baked-in repos)
mkdir -p "$HOME/repos"

# Seed baked-in repositories if they don't exist on the workspace (EFS)
# This runs on first container start and copies any repos from the image
if [ -d "/app/seed-repos" ] && [ "$(ls -A /app/seed-repos 2>/dev/null)" ]; then
  echo "→ Checking for seed repositories to copy..."
  for repo in /app/seed-repos/*; do
    if [ -d "$repo" ]; then
      repo_name=$(basename "$repo")
      if [ ! -d "$HOME/repos/$repo_name" ]; then
        echo "   Seeding repository: $repo_name"
        cp -r "$repo" "$HOME/repos/"
      else
        echo "   Repository already exists: $repo_name (skipping)"
      fi
    fi
  done
fi

# Configure shared Git identity (if not already set)
if [ ! -f "$HOME/.gitconfig" ]; then
  echo "→ Configuring Git identity..."
  git config --global user.name "${GIT_USER_NAME:-OpenChamber Bot}"
  git config --global user.email "${GIT_USER_EMAIL:-openchamber@company.com}"
  echo "   Git identity: ${GIT_USER_NAME:-OpenChamber Bot} <${GIT_USER_EMAIL:-openchamber@company.com}>"
else
  echo "→ Git identity already configured"
fi

# Verify OpenCode CLI is available
echo "→ Verifying OpenCode CLI..."
if ! command -v opencode &> /dev/null; then
    echo "ERROR: OpenCode CLI not found in PATH"
    exit 1
fi
echo "   OpenCode version: $(opencode --version)"

# Display configuration summary
echo "==================================================="
echo "  Configuration Summary"
echo "==================================================="
echo "  HOME:          $HOME"
echo "  WORKDIR:       $(pwd)"
echo "  USER:          $(whoami)"
echo "  OPENCODE_PATH: $(which opencode)"
echo "==================================================="

# Start OpenChamber using Bun directly
# Run the CLI from the /app directory where we copied the built files
echo "→ Starting OpenChamber..."
cd /app
exec bun bin/cli.js --port 3000
