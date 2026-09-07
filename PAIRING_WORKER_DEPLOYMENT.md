# Pairing Worker deployment

The application keeps its existing public Worker URL. The public Worker in
`worker.js` forwards only `/generate-round` to the dedicated Worker in
`pairing-worker.js` through a Cloudflare service binding.

## Cloudflare dashboard

1. Create a Worker named `scs-pairing` and deploy `pairing-worker.js` to it.
2. Open the existing `scs-app` Worker.
3. Go to **Settings > Bindings > Service bindings**.
4. Add a binding with variable name `PAIRING_WORKER` and service `scs-pairing`.
5. Deploy the updated `worker.js` to `scs-app`.

The binding name is case-sensitive. If it is missing, `/generate-round`
returns HTTP 503 instead of running scheduler code in the database Worker.

## Wrangler equivalent

Add this service binding to the main Worker's configuration:

```toml
[[services]]
binding = "PAIRING_WORKER"
service = "scs-pairing"
```

The pairing Worker does not require Supabase, authentication, subscription,
LINE, Google, or token secrets.

## Recovery

`worker-backup-before-pairing-split-2026-08-07.js` is the complete Worker from
before the split. It contains both the backend and scheduler implementations.
