#!/usr/bin/env bash
set -euo pipefail

# PRODX-POS: bootstrap GitHub Actions -> Google Cloud Workload Identity Federation.
# Run from an authenticated Google Cloud Shell / gcloud environment.
# This script creates no long-lived service-account key.

PROJECT_ID="${PRODX_GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
PROJECT_ID="${PROJECT_ID//$'\n'/}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

POOL_ID="${PRODX_WIF_POOL_ID:-github-prodx}"
PROVIDER_ID="${PRODX_WIF_PROVIDER_ID:-github-prodx}"
SERVICE_ACCOUNT_ID="${PRODX_GCP_SERVICE_ACCOUNT_ID:-prodx-production-admin}"
REPOSITORY="${PRODX_GITHUB_REPOSITORY:-prodxowner-png/PRODX-POS}"

: "${PROJECT_ID:?Set PRODX_GCP_PROJECT_ID or configure gcloud project first}"

command -v gcloud >/dev/null
command -v jq >/dev/null

echo "Project: $PROJECT_ID ($PROJECT_NUMBER)"
echo "Repository: $REPOSITORY"
echo "Service account: $SERVICE_ACCOUNT_ID"

gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com

if ! gcloud iam workload-identity-pools describe "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --display-name="PRODX GitHub Actions"
fi

PROVIDER_FLAGS=(
  --project="$PROJECT_ID"
  --location=global
  --workload-identity-pool="$POOL_ID"
  --issuer-uri="https://token.actions.githubusercontent.com"
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref,attribute.workflow=assertion.workflow"
  --attribute-condition="assertion.repository == '$REPOSITORY'"
)

if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --display-name="GitHub Actions OIDC" \
    "${PROVIDER_FLAGS[@]}"
else
  # Reconcile an existing provider instead of assuming an earlier bootstrap
  # created the exact issuer/mapping/condition required by this repository.
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" \
    "${PROVIDER_FLAGS[@]}"
fi

PROVIDER_STATE="$(
  gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$POOL_ID" \
    --format='value(state)'
)"

if [[ "$PROVIDER_STATE" != "ACTIVE" ]]; then
  echo "ERROR: WIF provider $PROVIDER_ID is not ACTIVE (state=$PROVIDER_STATE)." >&2
  exit 1
fi

SA_EMAIL="${SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_ID" \
    --project="$PROJECT_ID" \
    --display-name="PRODX production automation"
fi

POOL_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"
PRINCIPAL="principalSet://iam.googleapis.com/${POOL_RESOURCE}/attribute.repository/${REPOSITORY}"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="$PRINCIPAL"

PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

cat <<EOF

PRODX WIF bootstrap complete.

GitHub Actions repository variables:
  GCP_WORKLOAD_IDENTITY_PROVIDER=$PROVIDER_RESOURCE
  GCP_SERVICE_ACCOUNT=$SA_EMAIL

No service-account private key was created.

The service account currently has only the Workload Identity User binding created
by this script. Add application-specific IAM roles separately, using least privilege.
EOF
