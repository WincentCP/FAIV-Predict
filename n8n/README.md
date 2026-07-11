# FAIV Predict automation

The workflow in `workflow_sync_retrain.json` has two operator-owned schedules:

- Monday 06:00 Asia/Jakarta: call the authenticated ML sync/retrain pipeline.
- Daily 07:00 Asia/Jakarta: verify configured Instagram connections.

The workflow is deliberately imported **inactive**. Importing code must never
start production synchronization or send email without an operator review.

## Supported runtime

n8n is pinned to `2.29.10`. Its current Node requirement is Node `>=22.22`, so
the repository's Node 24 runtime is supported. Docker Compose remains the
recommended deployment because it pins the n8n image and persists its encrypted
credential database in the `n8n_data` volume.

## Local Docker setup

1. Copy the variables in `.env.example` into the repository root `.env` (the
   file is gitignored). Use the same `INTERNAL_API_TOKEN` as the frontend and ML
   service. Generate one stable encryption key, for example with
   `openssl rand -hex 32`.
2. Start the stack with `docker compose up --build`.
3. Open `http://localhost:5678`, create the local owner account, then import the
   workflow once:

   ```bash
   docker compose exec n8n n8n import:workflow \
     --input=/workflows/workflow_sync_retrain.json
   ```

4. In the editor, select a real SMTP credential for each Email Send node.
5. Run the health branch manually. Confirm that it reaches the private ML
   service and that no email is sent to an unintended recipient.
6. Only then activate the workflow.

The editor is bound to loopback by default. Production deployment requires an
HTTPS reverse proxy, `N8N_PROTOCOL=https`, public editor/webhook URLs, secure
cookies, access control, backups for the n8n volume, and a stable encryption
key supplied by the deployment secret manager.

## Local native smoke test

Docker is not required to verify the runtime. The commands below keep all n8n
state inside the gitignored `n8n/.data` directory and do not activate schedules:

```bash
cd n8n
export N8N_USER_FOLDER="$PWD/.data"
export N8N_DIAGNOSTICS_ENABLED=false
export N8N_PERSONALIZATION_ENABLED=false
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false
npm --cache /tmp/faiv-n8n-cache exec --yes --package=n8n@2.29.10 -- \
  n8n import:workflow --input=workflow_sync_retrain.json
npm --cache /tmp/faiv-n8n-cache exec --yes --package=n8n@2.29.10 -- n8n start
```

Check `http://127.0.0.1:5678/healthz`. A `200` proves only that n8n is healthy;
it does not prove Meta, SMTP, Supabase, or the ML pipeline credentials work.

## Safety and failure behavior

- The ML requests carry `X-Internal-Token`; n8n and the ML service must share
  the same non-empty secret.
- n8n 2.x blocks `$env` expressions by default. This workflow intentionally
  enables them so secrets stay out of the JSON. The editor must therefore stay
  private and access-controlled; untrusted users must never receive editor
  access.
- HTTP errors continue to the failure branch so an API timeout does not skip
  the operator notification path.
- Execution history is pruned after seven days in the Compose runtime.
- No Meta, Supabase, SMTP, or user credentials belong in the workflow JSON.
- `IG_BRANDS_JSON` remains an ML-service concern. With no verified brand
  bindings, sync must report that it is unavailable rather than invent data.
