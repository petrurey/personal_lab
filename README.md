# Personal Lab

A dependency-free personal dashboard with three sections:

- **Plans:** the full, unchanged original identity development plan when running locally. The public website shows local-access instructions instead of a replacement roadmap.
- **Labs:** the original PIM field lab, including its interactive controls and downloadable scripts.
- **Info:** the original interactive Microsoft Entra built-in roles reference.

The landing page presents three distinct, high-contrast columns with compact category headings and independently scrollable, keyboard-focusable page lists. Plans is green, Labs is blue and Info is purple. Each heading also opens its dedicated category page (`plans/`, `labs/` or `info/`), showing only that category's searchable cards. Category pages reuse the same palette and high-contrast card styles, including themed headings, active navigation, and search controls. There is no introductory or footer text around the index columns. Header navigation and the imported pages' floating navigation link directly to category pages. All site links are relative and work under a GitHub Pages repository path.

## Run locally

Requires Node.js 22 or newer. No dependency installation or build is needed.

```sh
npm test
npm start
```

Open http://127.0.0.1:4173. Stop the server with Ctrl+C.

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

The workflow tests the site and uploads only the public HTML pages and asset directories, never `.private`, scripts, repository metadata or local tools.
