# Personal Lab

A dependency-free personal dashboard with three sections:

- **Plans:** the public study portion of the existing identity development plan, with six milestones and 25 browser-saved checkpoints.
- **Labs:** the original PIM field lab, including its interactive controls and downloadable scripts.
- **Info:** the original interactive Microsoft Entra built-in roles reference.

The landing page presents three distinct, high-contrast columns with compact category headings and independently scrollable, keyboard-focusable page lists. Plans is green, Labs is blue and Info is purple. Each heading also opens its dedicated category page (`plans/`, `labs/` or `info/`), showing only that category's searchable cards. There is no introductory or footer text around the index columns. Header navigation and the imported pages' floating navigation link directly to category pages. All site links are relative and work under a GitHub Pages repository path.

## Run locally

Requires Node.js 22 or newer. No dependency installation or build is needed.

```sh
npm test
npm start
```

Open http://127.0.0.1:4173. Stop the server with Ctrl+C.

## Original development plan and privacy

The full, unchanged development plan is preserved at `.private/identity-development-plan.html` on this computer. Open that file directly to use the original work portfolio. It is intentionally excluded from Git, the preview server, and the deployment artifact because it contains internal organizational resource links and work records.

The hosted plan includes only the original public SC-300 study stages, learning modules and target dates. No internal delivery records or internal links are published. Browser-stored progress from the original plan is not migrated. Neither study progress nor lab notes sync across devices or back to GitHub. Avoid entering sensitive information in browser notes; the website is public.

## Refresh imports

With the original source files in your home directory:

```sh
npm run import
npm test
```

Or specify the source folder with `npm run import -- "C:\path\to\sources"`. The importer expects `pim-lab/pim_lab.html`, `entra-roles.html` and `identity-development-plan.html`. Refreshing overwrites the imported copies, not the originals. The public plan deliberately uses its own progress storage key.

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
