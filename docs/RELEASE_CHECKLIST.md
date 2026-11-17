# Public release checklist

- [ ] Review the complete diff and confirm that no production code/configuration was reintroduced.
- [ ] Run a secret scanner against the repository.
- [ ] Confirm `.env`, `.data/`, `output/`, customer media, and provider credentials are not staged.
- [ ] Run `npm install`, `npm run typecheck`, and `npm test`.
- [ ] Confirm external-provider calls are disabled in CI and test suites remain mocked.
- [ ] Review provider terms and data-handling requirements before using real customer assets.
- [ ] Add a license only after choosing the rights you intend to grant.
- [ ] Confirm ownership/permission for any fonts, music, SFX, sample images, and future media assets.
- [ ] Review the README and interview notes to avoid claiming a runtime MCP Agent framework or benchmark that is not included.

