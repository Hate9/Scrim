# Scrim

A desktop Markdown editor for Linux and Windows that edits the document in its rendered
form, showing Markdown syntax only where the cursor is. Built with Tauri 2.

Status: **P0 (skeleton)**. Opens and saves Markdown files as plain text, with atomic
saves, encoding and line-ending preservation, single-instance handling, and no network
access. See `spec/spec/00-overview.md` for the phases.

- Specification: `spec/` (start with `spec/README.md`)
- Implementation notes: `DESIGN.md`
- Questions for the spec team: `QA-LOG.md`
- Third-party licenses: `THIRD_PARTY.md`; sources consulted: `PROVENANCE.md`

## Build and run

```bash
npm install
```

```bash
npx tauri build --debug --no-bundle
```

```bash
target/debug/scrim path/to/file.md
```

## Test

```bash
cargo test --workspace && npm test
```

```bash
scripts/e2e.sh
```

```bash
scripts/n1-network.sh
```
