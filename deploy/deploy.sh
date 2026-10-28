#!/usr/bin/env bash
# Runs ON THE VM (as root, via the GitHub Actions IAP SSH step).
# Usage: sudo bash deploy.sh <backend-image> <frontend-image>
set -euo pipefail

BACKEND_IMAGE="${1:?usage: deploy.sh <backend-image> <frontend-image>}"
FRONTEND_IMAGE="${2:?usage: deploy.sh <backend-image> <frontend-image>}"
APP_DIR=/opt/profile-app
REGISTRY_HOST="${BACKEND_IMAGE%%/*}"    # e.g. us-east1-docker.pkg.dev
MD=http://metadata.google.internal/computeMetadata/v1

# Docker is installed by the VM startup script; wait for it on a fresh VM.
for _ in $(seq 1 60); do docker compose version >/dev/null 2>&1 && break; sleep 5; done
docker compose version >/dev/null

install -d -m 750 "$APP_DIR"
install -m 640 /tmp/profile-app/docker-compose.yml "$APP_DIR/docker-compose.yml"
cd "$APP_DIR"

# The VM's own service account pulls the images (roles/artifactregistry.reader).
gcloud auth configure-docker "$REGISTRY_HOST" --quiet >/dev/null 2>&1

# Firestore connection string, set by Terraform (infra/terraform/compute.tf) as instance metadata.
# It contains no credentials: the backend authenticates with the VM's service account.
MONGO_URL="$(curl -fsS -H 'Metadata-Flavor: Google' "$MD/instance/attributes/mongo-url")"

umask 077
cat > .env <<ENV
BACKEND_IMAGE=${BACKEND_IMAGE}
FRONTEND_IMAGE=${FRONTEND_IMAGE}
MONGO_URL=${MONGO_URL}
ENV

docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune -f >/dev/null

# Wait for the stack, then make sure the backend can actually reach Firestore
# (/api/health pings the database and returns 503 if it cannot).
for _ in $(seq 1 30); do
  if curl -fsS http://localhost/healthz >/dev/null 2>&1; then
    if curl -fsS http://localhost/api/health >/dev/null 2>&1; then
      echo "Deployed backend ${BACKEND_IMAGE} and frontend ${FRONTEND_IMAGE} (Firestore reachable)"
      docker compose ps
      rm -rf /tmp/profile-app
      exit 0
    fi
  fi
  sleep 2
done

echo "App is not healthy or cannot reach Firestore" >&2
echo "--- backend logs ---" >&2
docker compose logs --tail=100 backend >&2
echo "--- frontend logs ---" >&2
docker compose logs --tail=100 frontend >&2
exit 1
