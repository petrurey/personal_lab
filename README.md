# Personal Lab

A dependency-free personal dashboard with three sections:

- **Plans:** the full, unchanged original identity development plan when running locally. The public website shows local-access instructions instead of a replacement roadmap.
- **Labs:** the original PIM field lab and a new application-access field lab, both with interactive controls and downloadable scripts.
- **Info:** the original interactive Microsoft Entra built-in roles reference.

The landing page presents three distinct, high-contrast columns with compact category headings and independently scrollable, keyboard-focusable page lists. Plans is green, Labs is blue and Info is purple. Each heading also opens its dedicated category page (`plans/`, `labs/` or `info/`), showing only that category's searchable cards. Category pages reuse the same palette and high-contrast card styles, including themed headings, active navigation, and search controls. There is no introductory or footer text around the index columns. Header navigation and the imported pages' floating navigation link directly to category pages. All site links are relative and work under a GitHub Pages repository path.

## Run locally

Requires Node.js 22 or newer. No dependency installation or build is needed.

```sh
npm test
npm start
```

Open http://127.0.0.1:4173. Stop the server with Ctrl+C.

## Application access field lab

Open [Access management for apps](labs/app-access-lab.html) directly, from the Labs card, or at https://petrurey.github.io/personal_lab/labs/app-access-lab.html.

The independently authored lab maps all four modules in the linked Microsoft Learn path to 16 field modules. Every module separates **Technical configuration** (exact portal navigation, fields/values and verification) from collapsed **Knowledge & context** (explanations/references). Automation alternatives are separately expandable. Start here links the core execution order; licensed extensions identify their prerequisites. Coverage includes discovery/connectors, delegated app administration, gallery/custom SSO, proxy/KCD, SCIM, claims/consent, registration, API permissions/OBO, roles, SPA/multitenant design, governance, App launchers/collections, Azure Log Analytics export and the two-user comparison. Unavailable extensions must be recorded as not run.

The [local capstone sample](labs/app-access-sample/) is a separate Node.js 22+ application. GitHub Pages serves its source only. After preparing a disposable tenant using the lab's portal instructions or [automation.ps1](labs/app-access-sample/automation.ps1), set `TENANT_ID`, `CLIENT_ID` and the temporary `CLIENT_SECRET` **in the local terminal only** (or call `Use-LabClient` in the initialized helper session), then run:

```powershell
Set-Location .\labs\app-access-sample
npm ci
npm test
npm start
```

Open http://localhost:4300. The app uses tenant-specific OIDC, authorization code/PKCE, state/nonce and ID-token signature checks. It enforces `Lab.Reader` on the server, returns 401 when anonymous and 403 for an authenticated Observer, and calls Graph `/me` only for Readers. It binds to loopback; this teaching server and its HTTP cookie configuration are not production hosting.

Root `npm test` also runs the sample's native tests. The HTTP integration test stubs the identity provider; after installing the sample dependencies, a separate real-library test uses locally generated signed JWTs and mocked HTTPS responses to verify rejection of invalid state, nonce, audience, issuer, expiry and signature. That test is skipped if the dependency is absent; CI installs it. No test contacts a real tenant. Tests do not prove real tenant sign-in, permissions, provisioning, proxy or governance. Run the lab's two-user comparison and fresh-session controls for those results. With PowerShell 7, root tests parse every downloadable PowerShell block/both helpers and run offline configuration-contract tests with mocked Graph/Azure commands.

### Automation parity

Each expandable route states its result and required shared operations. Registration (07), permission consent (08), and role assignment (09) are separate writes: 07 does not grant consent or assign users. The helper configures users, delegated administration, Entra SAML/proxy/KCD settings, claims/consent policies, API scopes/app-only grants, SPA/multitenant home registrations, group access, Observer/revocation controls, report-only MFA and an actual Azure workspace/diagnostic export. Secret expiry and workspace retention are explicitly the same in both routes. Random IDs, secret/certificate bytes and timestamps naturally differ.

Dot-source `automation.ps1` from the sample folder, then call `Initialize-LabAutomation -TenantId <guid> -AdminId <guid>` as shown in section 00. Graph connections verify both identities. Only IDs and restoration baselines are saved in `.app-access-lab-state.json`; passwords/secrets stay in process memory. SAML public certificates are written to `.app-access-lab-*.cer`. These local generated files are ignored by Git and blocked by the preview. Never commit credentials, tokens, `.env` or tenant state.

**Shared/manual boundaries are intentional, not fake automated completion:** vendor SAML trust/accounts, connector installation/AD configuration, real browser/target verification, separate client/API implementations, second-tenant consent/assignments and My Apps collections retain their stated shared steps. Discovery/Defender connectors and AD FS reporting (01), vendor-specific complete SCIM configuration (05), and Defender OAuth policy creation (11) are explicitly manual-only here. No inventory query, generic provisioning job or SP-disable operation is presented as an equivalent alternative for those workflows.

`Remove-LabAutomation` confirms the tenant, restores pending consent baselines and deletes only recorded Graph objects after identity checks, in reverse dependency order. `Remove-LabLogExport` separately confirms the Azure tenant/subscription, verifies the diagnostic destination and refuses a resource group containing other resources. Shared/vendor/proxy-group/host/AD and second-tenant cleanup is still required in section 15. Do not portal-delete the helper's recorded objects before its cleanup or rerun creation commands after a partial failure; inspect the state and clean up first. Start a new exercise in a fresh folder.

The older [tenant.ps1](labs/app-access-sample/tenant.ps1) combined Setup/Inspect/Cleanup remains compatible with `app-access-lab.json`, but is not used as section 07's alternative because it also executes 08-09. Its cleanup only deletes its exact core app/SP; its state is not interchangeable with the new helper's state.

The new page derives its visual base and controls from the unchanged PIM lab. If that source style changes, regenerate the checked-in app assets with `node scripts\sync-app-lab-style.mjs`, then `npm test`. The apps lab uses a separate browser-storage key and reports storage failures explicitly. Notes/progress remain browser-local, are exportable, and never perform tenant operations.

## Original development plan and privacy

The original is `identity-development-plan.html` in your home folder (`C:\Users\petrurey\identity-development-plan.html` on this computer). With `npm start` running, the plan cards open `/plans/development-plan.html`, which serves that original file byte-for-byte, with no added markup, styles or navigation. You can also open the original file directly. To use a different source path, set the `IDENTITY_PLAN_PATH` environment variable before starting the server.

A backup remains at `.private/identity-development-plan.html`, excluded from Git and deployment. The local server only exposes the original at its designated plan route, not the `.private` folder, and binds exclusively to `127.0.0.1`. It reports an explicit error if the source is missing; it never substitutes a different plan.

The hosted plan page contains instructions for opening the local original. It does not publish internal work records or organization-only links, and does not display a rewritten study roadmap. GitHub Pages cannot open a file on your computer. Browser storage from a `file:` URL is separate from localhost storage; existing progress is not automatically migrated. Neither study progress nor lab notes sync across devices or back to GitHub.

## Refresh imports

With the original source files in your home directory:

```sh
npm run import
npm test
```

Or specify the source folder with `npm run import -- "C:\path\to\sources"`. The importer expects `pim-lab/pim_lab.html`, `entra-roles.html` and `identity-development-plan.html`. Refreshing overwrites the imported copies and private backup, not the originals. The importer does not rewrite or publish the development plan.

## Publish on GitHub Pages

GitHub Pages is static hosting; GitHub Actions deploys it. No Azure Functions or backend is needed.

After authenticating GitHub CLI with `gh auth login` and installing Git:

```sh
git init -b main
git add .
git commit -m "Create personal learning dashboard" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
gh repo create personal_lab --public --source=. --remote=origin --push
gh api --method POST repos/{owner}/personal_lab/pages -f build_type=workflow
gh workflow run pages.yml
```

Replace `{owner}` with your GitHub login. If Pages already exists, use the repository's **Settings > Pages > Source: GitHub Actions**. The resulting URL is `https://{owner}.github.io/personal_lab/`.

The workflow installs the sample's locked dependencies for its real-library validation, tests the site, and uploads only the public HTML pages and asset directories, including the authored sample source under `labs/`, never `.private`, root tooling scripts, repository metadata or local tools. Public staging explicitly excludes `node_modules`, so dependencies do not enter the Pages artifact.
