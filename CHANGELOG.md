# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-04-13
### Added
- Initial project setup for L3TT3R.
- React frontend with Vite, Vanilla CSS, and Glassmorphism design.
- Firebase Realtime Database integration.
- Multiplayer matchmaking, game states, and loop logic implemented.
- English-to-Chinese translation for guessed words.

## [0.0.2] - 2026-04-13
### Security
- Hardened database security rules to prevent unauthorized data access and modifications.
- Improved environment configuration management for enhanced security.

## [0.1.0] - 2026-04-16
### Added
- Integrated user accounts and statistics tracking.
- Added support for persistent user profiles and guest account linking.
- New game modes and lobby configuration options for word length and win targets.
- Enhanced UI consistency and glassmorphism styling across the app.

## [0.1.2] - 2026-04-17
### Added
- Fluid Typography: Action buttons now use `self-adjusting` font sizes (via `clamp()`) to prevent text wrapping on small screens.
- Standardized UI: Unified onboarding and lobby button classes for a more consistent cross-device experience.
- Alphanumeric Validation: Strict regex filtering for usernames to ensure database compatibility.

### Changed
- Cost-Efficiency: Reverted word-bank storage to a single-document map structure, reducing Firestore read counts for small-to-medium profiles while maintaining scalability.
- Improved UX: Renamed "Skip" to "Skip for Now" during account linking.
- Optimized Stats: High-level statistics are now cached directly on the user profile for near-zero read costs.

### Fixed
- Firestore Permissions: Hardened security rules for `user_versus_matches` and `user_words` to eliminate authorization errors.
- Mobile Layout: Resolved overflow and alignment issues with badges and buttons on iPhone SE/Mini viewports.

## [0.1.1] - 2026-04-16
### Added
- Word Bank: Track and browse every unique word you have formed across all modes.
- Grouped word display with frequency tracking.

### Fixed
- Real-time profile synchronization: Stats and Word Bank now update instantly after matches.
- Matchmaking "zombies": Public rooms now correctly re-list if a guest disconnects early.
- Performance: Removed redundant legacy code and optimized Firebase listeners.
