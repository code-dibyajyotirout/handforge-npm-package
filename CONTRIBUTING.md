# Contributing to HandForge

Thank you for your interest in contributing to HandForge. We welcome contributions that maintain the technical rigor, performance, and documentation standards of this repository.

---

## Code of Conduct

All contributors are expected to adhere to our [Code of Conduct](./CODE_OF_CONDUCT.md). Please interact professionally and constructively.

---

## Technical Guidelines

- Zero Emojis: All source files, commit messages, comments, and issue submissions must maintain zero emojis.
- Strong Typing: All code must be written in TypeScript with explicit type definitions. Avoid using `any` unless interacting with dynamic third-party WASM payloads.
- Test Coverage: Any new math routines, engine algorithms, or serialization handlers must include unit tests under `tests/`.
- Performance Budgets: Avoid per-frame memory allocations inside the render and gesture tracking loops. Cache vectors, matrices, and materials.

---

## Development Workflow

1. Fork the repository and create a feature branch (`git checkout -b feature/improved-kernel`).
2. Make your modifications.
3. Verify test suites pass:
   ```bash
   npm run test
   ```
4. Build the distribution bundle:
   ```bash
   npm run build
   ```
5. Submit a Pull Request targeting the `main` branch.
