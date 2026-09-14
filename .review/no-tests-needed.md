# The tests ran; it is `node_modules` that is missing

Not a claim that this change needs no tests. It has them and they pass - the
scope-check's `node_modules` probe is the wrong proxy for "the tests can run"
in this repo.

- `npm test` is `node --test test/*.test.js`. It has no runtime dependencies,
  so it runs in a worktree with no `node_modules`: 1188 tests, 0 failures, at
  70df41d.
- `npm run typecheck` resolves `tsc` from the base checkout's
  `node_modules/.bin`, because npm adds every ancestor directory's `.bin` to
  PATH. It is a real check, not a silent no-op - it reported TS2345, TS2554 and
  three others during this session, each of which had to be fixed. Clean now on
  both programs.
- The browser checks run against `node tools/serve.js` on port 8731: 45 of 45.

`~/gotab/workflow/bin/worktree-bootstrap` would make this worktree hold its own
`node_modules` and satisfy the probe directly. It was denied here by the
permission classifier as `[Irreversible Local Destruction]`, and working around
a denial is not something a session should do on its own judgement - so it is
in the report for Robert to run or to allow instead.
