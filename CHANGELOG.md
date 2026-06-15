# Changelog

## [0.6.0-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.5.1-alpha.1...agent-cya-v0.6.0-alpha.1) (2026-06-15)


### Features

* **suggest:** add agent-cya suggest subcommand ([b9deb9d](https://github.com/ike18t/Agent-CYA/commit/b9deb9dda2d39b13f46907d53ac8cb2734ffb4f6))


### Bug Fixes

* **audit-log:** point createAuditLogger tests at tmpdir to stop polluting ~/.agent-cya/audit.log ([1aa4d43](https://github.com/ike18t/Agent-CYA/commit/1aa4d4315e51b4f118365204a23e67527af1e6f9))

## [0.5.1-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.5.0-alpha.1...agent-cya-v0.5.1-alpha.1) (2026-06-15)


### Build

* **deps-dev:** bump @types/node from 24.13.2 to 25.9.3 ([ff1a28a](https://github.com/ike18t/Agent-CYA/commit/ff1a28ab8bc636250366f09fbe31c4e919a23fd6))
* **deps-dev:** bump typescript from 5.9.3 to 6.0.3 ([2a94069](https://github.com/ike18t/Agent-CYA/commit/2a94069c547c6cacffe6b9c480209fe664beb9de))
* **deps-dev:** bump vitest from 3.2.6 to 4.1.9 ([e01a4c9](https://github.com/ike18t/Agent-CYA/commit/e01a4c989770dce4b473c9c4991726ecd08c372e))
* **deps:** bump actions/checkout from 4.3.1 to 6.0.3 ([a39885a](https://github.com/ike18t/Agent-CYA/commit/a39885a89b4edf67ad243b125f74258a9778b7ba))
* **deps:** bump actions/setup-node from 4.4.0 to 6.4.0 ([e83ac8d](https://github.com/ike18t/Agent-CYA/commit/e83ac8d0805e1360348d2bff0f01751ba4d8405d))
* **deps:** bump commander from 12.1.0 to 15.0.0 ([4a39bcf](https://github.com/ike18t/Agent-CYA/commit/4a39bcf61b81ff5f02fcc483f3055efe3fefaeed))

## [0.5.0-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.4.0-alpha.1...agent-cya-v0.5.0-alpha.1) (2026-06-15)


### Features

* per-harness reviewer overrides ([#18](https://github.com/ike18t/Agent-CYA/issues/18)) ([689245b](https://github.com/ike18t/Agent-CYA/commit/689245bf09adf4634c966584870b5c20f5325684))

## [0.4.0-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.3.1-alpha.1...agent-cya-v0.4.0-alpha.1) (2026-06-15)


### Features

* **bash-ast:** parse bash commands into a domain AST ([becc257](https://github.com/ike18t/Agent-CYA/commit/becc2576032371adab8efbdd447d51010e506e8b))
* **deps:** add tree-sitter and tree-sitter-bash ([917e03b](https://github.com/ike18t/Agent-CYA/commit/917e03bb51780baa991d736bebe6d1e808d4a39b))
* **rules:** add 18 flag-aware structural rules ([f5f6377](https://github.com/ike18t/Agent-CYA/commit/f5f637730a2c79614735ad21f87c0b41046146ac))


### Bug Fixes

* **bash-ast:** descend into redirected_statement bodies ([bf4246c](https://github.com/ike18t/Agent-CYA/commit/bf4246c906280f05e9b11b45c3ddeed4f53832f7))
* **rules:** close known follow-ups from review ([194d952](https://github.com/ike18t/Agent-CYA/commit/194d95266f69fdc5a0c07569922970315489cb3d))


### Refactoring

* **rules:** replace regex with structural AST predicates ([026ef61](https://github.com/ike18t/Agent-CYA/commit/026ef612201242535eed9cf8a7e86867e93824a6))

## [0.3.1-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.3.0-alpha.1...agent-cya-v0.3.1-alpha.1) (2026-06-15)


### Refactoring

* replace AGENT_CYA_MIN_ASK_MS env var with --min-ask-ms CLI flag ([9f53816](https://github.com/ike18t/Agent-CYA/commit/9f53816ce004f58aa549b7056989c0fc1f9b589f))

## [0.3.0-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.2.3-alpha.1...agent-cya-v0.3.0-alpha.1) (2026-06-15)


### Features

* add --reviewer openai for OpenAI-compatible HTTP endpoints ([21e315c](https://github.com/ike18t/Agent-CYA/commit/21e315c2faf972355df6be4153db8dad1cdc60f0))
* **audit:** record which reviewer made the decision ([25b9c50](https://github.com/ike18t/Agent-CYA/commit/25b9c50c170296c3a5708ff81e402b1363afa50a))


### Refactoring

* group harnesses/ and reviewers/ under their own dirs ([c878580](https://github.com/ike18t/Agent-CYA/commit/c8785804893defbbef23c6e09bf41569ac188bec))


### Documentation

* rewrite README for consumers; move dev/maintainer content to AGENTS ([96cb538](https://github.com/ike18t/Agent-CYA/commit/96cb538ce000b3ee9d57f5a4e6b4a1557475b9bd))

## [0.2.3-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.2.2-alpha.1...agent-cya-v0.2.3-alpha.1) (2026-06-14)


### Build

* **deps-dev:** bump eslint-plugin-functional from 9.0.5 to 10.0.0 ([303b32e](https://github.com/ike18t/Agent-CYA/commit/303b32e5270d935fea8c86739c45b7db7d635e6d))

## [0.2.2-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.2.1-alpha.1...agent-cya-v0.2.2-alpha.1) (2026-06-14)


### Build

* **deps-dev:** bump @opencode-ai/plugin from 1.17.4 to 1.17.6 ([414c0b6](https://github.com/ike18t/Agent-CYA/commit/414c0b6595e28c618cb089242ea216e55b84589b))

## [0.2.1-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.2.0-alpha.1...agent-cya-v0.2.1-alpha.1) (2026-06-14)


### Build

* **deps-dev:** bump eslint from 9.39.4 to 10.5.0 ([60c96fb](https://github.com/ike18t/Agent-CYA/commit/60c96fb03f4ab0aa133906b76fc119cd0e6225fd))
* **deps-dev:** bump eslint from 9.39.4 to 10.5.0 ([e6fa8b9](https://github.com/ike18t/Agent-CYA/commit/e6fa8b95485a11c260651d41d24d2d07d18be235))

## [0.2.0-alpha.1](https://github.com/ike18t/Agent-CYA/compare/agent-cya-v0.1.0-alpha.1...agent-cya-v0.2.0-alpha.1) (2026-06-14)


### Features

* add a time padding before an llm allow ([6373fd6](https://github.com/ike18t/Agent-CYA/commit/6373fd69e9fe69efebb5898b595a0fd2fe304759))
* **audit:** size-cap the log with single-step rotation ([34f6aa5](https://github.com/ike18t/Agent-CYA/commit/34f6aa59898785337f90c3595963af47fa5b20b7))
* built-in hook-claude-code subcommand; document OpenCode plugin pattern ([2886523](https://github.com/ike18t/Agent-CYA/commit/2886523eb4365948559551c331aa520b1d4bd96b))
* initial commit — hard deny rules + binary LLM review + audit logging ([950c424](https://github.com/ike18t/Agent-CYA/commit/950c4248c0ea1651037d2820b4a4abcefa03f7dd))
* **opencode:** ship plugin as agent-cya/opencode subpath export ([7db1461](https://github.com/ike18t/Agent-CYA/commit/7db1461c784dca3ed3955994c73566aa1fccd464))
* retry LLM once on transient failures, surface cause in fallback reason ([ec7f343](https://github.com/ike18t/Agent-CYA/commit/ec7f343db84c82a616fe5fcab27a15b0fb6db73e))


### Bug Fixes

* **llm:** guard cleanup against missing child.kill and log the shape ([e0b5190](https://github.com/ike18t/Agent-CYA/commit/e0b51901287a6161a88371c3c5ef2bf2f4a9fc98))
* **llm:** log PATH on ENOENT to diagnose intermittent spawn failures ([535a98c](https://github.com/ike18t/Agent-CYA/commit/535a98c8afe5bf7a25794e7499b2ab40a05f0307))
* **rules:** require a word boundary before disk-utility commands ([7f3c7ec](https://github.com/ike18t/Agent-CYA/commit/7f3c7ec68a70486245fa079f502fce6c5f69ae68))


### Refactoring

* extract pipeline.ts, restructure CLI to 'hook &lt;harness&gt;', rename --reviewer, invert ask-padding to opt-in ([a415445](https://github.com/ike18t/Agent-CYA/commit/a415445755c6a38b9fcff9690be7083185e27781))


### Documentation

* refresh README — opencode caveat, harness terminology, releasing section ([5c51b87](https://github.com/ike18t/Agent-CYA/commit/5c51b87040db5a44016439bd2fff0bab03aedd4e))
* style product as 'AgentCYA' in prose, keep 'agent-cya' for the binary ([cd68ac8](https://github.com/ike18t/Agent-CYA/commit/cd68ac840b92ed534e77d375c03e175691be0c0d))


### Build

* ship agent-cya as a publishable npm package ([3d673be](https://github.com/ike18t/Agent-CYA/commit/3d673bef6035f8071adcd3f63671b2f65e8bfd69))
