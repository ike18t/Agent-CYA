# Changelog

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
