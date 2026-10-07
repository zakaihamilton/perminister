# Authorization storage benchmark

Run `npm run benchmark:auth` to model the storage work performed by `authorizeApiKey` at increasing activity-history sizes. The harness counts object reads and `ListObjectsV2` requests and records average local execution time for ten authorizations at each history size.

This benchmark uses an in-memory model of the Spaces store. It verifies the number of object operations made by the authorization path; its local timing is not representative of DigitalOcean network or bucket latency.

Measured on 2026-10-06:

| Activity events in bucket | Object reads per authorization | List requests per authorization |
| ------------------------: | -----------------------------: | ------------------------------: |
|                         0 |                              4 |                               0 |
|                       100 |                              4 |                               0 |
|                       500 |                              4 |                               0 |
|                     1,000 |                              4 |                               0 |

Authorization reads the API key, subject, organization, and product membership directly. Product membership contains its permission grants, so activity history does not change the request's storage cost. Product and activity pages still use indexed listings; their listing cost grows with the number of matching records.
