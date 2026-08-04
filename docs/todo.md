# Todo

## Tripo Operation History And Asset Recovery

- [ ] Treat the Tripo OpenAPI v3 `task_id` as the stable ID for each Tripo
  operation. Do not introduce Studio-only `operator_id` into this API path.
- [ ] Persist one operation-history record for every Tripo task, including the
  canvas run ID, node ID, operation type, `task_id`, status, progress, timestamps,
  credits, error, and output asset references.
- [ ] Store the `task_id` on the corresponding node run and preserve previous
  operations when a node is retried or regenerated.
- [ ] After task success, immediately resolve `GET /v3/tasks/{task_id}` output
  URLs and copy the model/preview into durable application storage before the
  Tripo URL expires.
- [ ] Give copied files a stable application asset ID and make nodes reference
  that asset ID rather than treating Tripo's `output.model_url` as permanent.
- [ ] Add a download/recovery path that prefers the application asset and uses
  `task_id` to re-query Tripo only when the copied asset is missing. Confirm
  whether Tripo re-issues a fresh URL before relying on this fallback.
- [ ] Persist asset files under the configured durable data/object-storage
  location in every runtime, including the K8s deployment; do not rely on the
  container filesystem.
- [ ] Add tests for operation history, retries, task recovery, asset persistence,
  and download behavior after the original Tripo URL has expired.
