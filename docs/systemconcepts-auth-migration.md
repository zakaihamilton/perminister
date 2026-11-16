# System Concepts authentication migration

System Concepts keeps its account ID, profile, and role in its own MongoDB record. Perminister becomes the password authority. Existing bcrypt verifiers are imported once and upgraded to Perminister's current scrypt format after the user's first successful login. No plaintext password is exported.

## Prepare Perminister

1. Create or confirm a product whose ID is `system-concepts`.
2. Create a consumer app client for the exact System Concepts production origin. Set its session lifetime, up to 30 days, and enable self-registration if new users should create their accounts through the System Concepts sign-in flow. The Perminister registration page will ask those users for a System Concepts ID.
3. Deploy Perminister with `PERMINISTER_ENABLE_SYSTEMCONCEPTS_IMPORT=true` and a random `PERMINISTER_SYSTEMCONCEPTS_IMPORT_SECRET` of at least 32 characters. Keep this secret only on the server and in the one-time import environment.

## Export and import

Use the same random 32-byte base64url key for both commands. Keep it out of source control and shell history. The export is AES-256-GCM encrypted and created with mode `0600`.

```sh
cd ~/git/systemconcepts
PERMINISTER_MIGRATION_ENCRYPTION_KEY="$MIGRATION_KEY" pnpm migration:export-auth -- --output /secure/systemconcepts-auth.enc
```

On a trusted machine that can reach Perminister, run the dry run first:

```sh
cd ~/git/perminister
PERMINISTER_BASE_URL="https://www.perminister.com" \
PERMINISTER_MIGRATION_ENCRYPTION_KEY="$MIGRATION_KEY" \
PERMINISTER_SYSTEMCONCEPTS_IMPORT_SECRET="$IMPORT_SECRET" \
pnpm migration:import-systemconcepts-auth /secure/systemconcepts-auth.enc
```

The dry run reports new accounts, email-matched accounts, and conflicts without writing records. Resolve every conflict before applying:

```sh
PERMINISTER_BASE_URL="https://www.perminister.com" \
PERMINISTER_MIGRATION_ENCRYPTION_KEY="$MIGRATION_KEY" \
PERMINISTER_SYSTEMCONCEPTS_IMPORT_SECRET="$IMPORT_SECRET" \
pnpm migration:import-systemconcepts-auth /secure/systemconcepts-auth.enc --apply
```

An email match links the System Concepts ID to the existing Perminister subject and leaves its password verifier unchanged. A conflicting ID or email is reported and not merged. The import is repeatable; already-linked records are skipped.

Imported accounts keep Perminister's existing email-verification state. New imported subjects are not marked verified automatically. If Perminister requires verification for an address, that user must complete its normal verification flow before using the System Concepts app.

After a successful import, disable the temporary endpoint by removing the import secret and setting `PERMINISTER_ENABLE_SYSTEMCONCEPTS_IMPORT=false`. Delete the encrypted export after the import is confirmed.

## Cut over System Concepts

Set these server and build-time values on System Concepts, then deploy:

```text
PERMINISTER_BASE_URL=https://www.perminister.com
PERMINISTER_APP_CLIENT_ID=<consumer client ID>
PERMINISTER_APP_CLIENT_SECRET=<consumer client secret>
PERMINISTER_AUTH_ENABLED=true
NEXT_PUBLIC_PERMINISTER_LOGIN_ENABLED=true
```

The app then signs in with OIDC and validates Perminister sessions on its server. Email and the product-specific System Concepts ID both work as login identifiers. Existing System Concepts passwords are accepted once through the imported bcrypt verifier and transparently rehashed to scrypt. System Concepts roles stay in its own MongoDB records.

Existing System Concepts passkeys remain a local fallback because WebAuthn credentials are bound to their original relying party and are not imported by this password migration. Users can continue to use those passkeys; password sign-in and password recovery move to Perminister. Existing local sessions must sign in again after cutover.
