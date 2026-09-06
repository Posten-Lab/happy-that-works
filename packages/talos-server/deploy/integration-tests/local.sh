#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
OVERLAY="$SCRIPT_DIR/../overlays/local"

echo "=== Talos Local Deployment (minikube) ==="

# 1. Ensure minikube is running
if ! minikube status --format='{{.Host}}' 2>/dev/null | grep -q Running; then
    echo "Starting minikube..."
    minikube start
else
    echo "minikube is running."
fi

# 2. Point docker to minikube's daemon
echo "Configuring docker to use minikube..."
eval $(minikube docker-env)

# 3. Build the server image
echo "Building talos-server:local image..."
docker build -t talos-server:local -f "$REPO_ROOT/Dockerfile.server" "$REPO_ROOT"

# 4. Run prisma migrations inside a temporary pod
echo "Running database migrations..."
kubectl --namespace talos-integration kustomize "$OVERLAY" --load-restrictor=LoadRestrictionsNone | kubectl --namespace talos-integration apply -f -

echo "Waiting for postgres to be ready..."
kubectl --namespace talos-integration wait --for=condition=ready pod -l app=talos-postgres --timeout=60s

# Run migrations via a one-shot job
kubectl --namespace talos-integration run talos-migrate --rm -i --restart=Never \
    --image=talos-server:local \
    --image-pull-policy=Never \
    --env="DATABASE_URL=postgresql://talos:talos@talos-postgres:5432/talos" \
    -- sh -c "cd /repo && pnpm exec prisma migrate deploy --schema=packages/talos-server/prisma/schema.prisma" \
    2>/dev/null

# 5. Restart server pods to pick up fresh image
echo "Restarting server pods..."
kubectl --namespace talos-integration rollout restart deployment/talos-server
kubectl --namespace talos-integration rollout status deployment/talos-server --timeout=120s

# 6. Print status
echo ""
echo "=== Deployed ==="
kubectl --namespace talos-integration get pods
echo ""
echo "Server replicas: $(kubectl --namespace talos-integration get deployment talos-server -o jsonpath='{.spec.replicas}')"
echo ""
echo "To access the server:"
echo "  kubectl --namespace talos-integration port-forward svc/talos-server 3005:3000"
echo ""
echo "To view logs from both pods:"
echo "  kubectl --namespace talos-integration logs -l app=talos-server --all-containers -f"
echo ""
echo "To test cross-process events, connect WebSocket clients"
echo "and verify events route between pods."
