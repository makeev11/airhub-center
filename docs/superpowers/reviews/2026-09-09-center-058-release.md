# AirHop Center 0.5.8: unified candidate

Status: local candidate; not yet deployed or installed.

## Agent acceptance

- Mentions use the active community's server principal registry. Only registered
  agents and humans are eligible; persona/team launch shortcuts are excluded.
- Locally managed identities from other relays are excluded even if stale channel
  membership remains. Names are not identity keys.
- Live diagnostic: the owner's Welcome test received a demo Fizz reply. The
  Analytics test mentioned HQ Fizz instead. Verify the corrected selection and
  response in the installed candidate before declaring the release ready.
- Runtime model configuration was not changed. Model labels must describe actual
  runtime configuration, not an assumed product name.
- No agent configuration modeling/persistence rules changed.

## Preservation and reset boundary

User explicitly chose to keep the current Mac identity and login. Preserve
organization, branches, groups, lessons, tariffs, knowledge materials, connection
credentials and registered agents. Back up before resetting only demo test
clients, operational history, conversations, analytics history and welcome state.
Do not use sign-out or an all-app-data wipe. Telegram's own message history is a
separate surface. Production is out of scope.

## Release gates still requiring execution

- Freeze one commit and build native/public/server artifacts from that identity.
- Backup demo and validate migrations on a restored clone.
- Guarded test-data reset with preservation checks before/after.
- Update demo and installed Mac application; compare release identities.
- Verify clean welcome, preserved settings/knowledge and live agent replies.

Local checks: TypeScript passed; registered-agent filter regression tests passed.
Full `just ci` log: `/private/tmp/airhop-unified-ci-058.log` (check final exit).
