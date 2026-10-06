# Authorization storage benchmark

Run `npm run benchmark:auth` to compare authorization work at increasing event-history sizes. The harness exercises `authorizeApiKey` against a model of the Spaces store and counts the `GetObject` and `ListObjectsV2` requests issued by the store methods. It also records the average in-process request time for ten authorizations at each history size.

This benchmark does not include DigitalOcean network latency or bucket response time. Treat the latency column as a local code-path comparison, and the object-read column as the number of modeled object reads. Run a separate read-only benchmark against a dedicated Spaces test tenant before making a storage decision that depends on production latency.

Measured on 2026-10-06:

| Events in history | Modeled object reads per authorization | List requests per authorization | Average local time |
| ----------------: | -------------------------------------: | ------------------------------: | -----------------: |
|                 0 |                                      6 |                               8 |           0.124 ms |
|               100 |                                    206 |                               8 |           0.197 ms |
|               500 |                                  1,006 |                               8 |           0.295 ms |
|             1,000 |                                  2,006 |                               8 |           0.570 ms |

The model grows by two reads per stored event because a permission check currently scans the full event history twice. Each authorization makes eight list requests in this fixture. These results are recorded for a future storage review; this work keeps Spaces as the only persistent record store.
