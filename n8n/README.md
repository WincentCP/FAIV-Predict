# FAIV Predict automation

`workflow_sync_retrain.json` is a portable, inactive-by-default template with two schedules:

- Monday 06:00 Asia/Jakarta: authenticated Instagram sync and retraining.
- Daily 07:00 Asia/Jakarta: Instagram connection health check.

The template intentionally contains no token, SMTP password, personal email address, or `$env` expression. The Compose runtime sets `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, so editable workflow code cannot read deployment environment variables.

## Supported runtime

n8n is pinned to `2.29.10` and persists its encrypted database in the named `n8n_data` volume. Keep the existing `N8N_ENCRYPTION_KEY` stable and back it up separately. Changing or losing that key makes stored credentials unreadable.

## First import

1. Start the stack:

   ```bash
   docker compose up -d --wait --wait-timeout 180
   ```

   Continue only after `frontend`, `ml-service`, and n8n report healthy. The
   n8n readiness probe includes its database and migrations, preventing the
   transient `503 Database is not ready!` state from being mistaken for ready.

2. Open `http://localhost:5678`, create the local owner, and import the workflow once:

   ```bash
   docker compose exec n8n n8n import:workflow --input=/workflows/workflow_sync_retrain.json
   ```

3. Create one **Header Auth** credential named `FAIV Internal API`:

   ```text
   Name:  X-Internal-Token
   Value: the same INTERNAL_API_TOKEN used by frontend and ml-service
   ```

4. Open both HTTP Request nodes:

   - `Check Instagram Connections`
   - `Sync Instagram and Retrain`

   Select `Generic Credential Type` → `Header Auth` → `FAIV Internal API`. The internal Docker URLs are already configured as `http://ml-service:8000/...`.

5. In all three Email Send nodes:

   - replace `alerts@example.invalid` and `operator@example.invalid`;
   - select the real SMTP credential;
   - never paste an SMTP password into a node field.

6. Save, execute both branches manually, inspect the output, then activate the workflow. A successful import alone does not prove Meta, Supabase, SMTP, or ML credentials work. Warning/failure emails lead into **Stop And Error** nodes so an unhealthy or partial business result is visibly failed in n8n execution history.

## Security verification

The following safe check prints only booleans, never secret values:

```bash
docker compose exec n8n node -e "console.log({blocked:process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE,hasToken:Boolean(process.env.INTERNAL_API_TOKEN),hasMlUrl:Boolean(process.env.FAIV_ML_URL)})"
```

Expected output:

```text
{ blocked: 'true', hasToken: false, hasMlUrl: false }
```

The Header Auth and SMTP values remain encrypted in the n8n database by `N8N_ENCRYPTION_KEY`. Do not commit `.env`, exported credentials, or the `n8n_data` volume.

## Existing installation

If the workflow already works in a persistent n8n volume, do not import the template again. Depending on workflow ID handling, importing can overwrite the installed workflow and clear local credential assignments or create a duplicate. Update the existing workflow in the UI, test it, and keep this JSON as the clean-install template.

## Recovery and backup

- Normal stop: `docker compose stop`.
- Recreate only n8n: `docker compose up -d --force-recreate --wait n8n`.
- Database-ready check: `http://127.0.0.1:5678/healthz/readiness` (plain `/healthz` is liveness only).
- Never use `docker compose down -v` unless permanent deletion of workflow and credential data is intended.
- Back up both the `n8n_data` volume and the stable `N8N_ENCRYPTION_KEY` before the thesis demonstration.

Production internet exposure is outside the bachelor-thesis scope. If deployed publicly later, place n8n behind HTTPS, enable secure cookies, restrict editor access, and use a managed secret store appropriate to the selected hosting environment.
