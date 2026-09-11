# Interface consistency and unified candidate

Scope: same checkout, preserving knowledge and client-thread work. Build a single
identified local/demo candidate after checks; no implicit production deployment.

1. Repair semantic chrome/menu/button states and keyboard focus, including readable
   disabled destructive actions and explanations. Verify paired AirHop/New Slack themes.
2. Audit channel/message UI strings, move copy into the shared reactive locale layer,
   and bind dates/plurals to the selected locale. Preserve user-authored content.
3. Use registered organization identities for the AirHop agent picker, not the global
   persona library. Reuse existing agents instead of spawning duplicate identities.
4. Classify humans versus service principals from canonical server records; preserve
   unnamed humans and protect system identities from ordinary member removal.
5. Verify isolation, locale switching, visual states and existing knowledge/analytics/
   client workflows. Run desktop gates and `just ci`; inspect screenshots and hashes.
6. Review the combined diff, freeze a signed-off commit, then prepare/build/verify one
   candidate with source/artifact receipts. Deployment and native live acceptance are
   separate gates. Never delete persona definitions or replace the installed app here.
