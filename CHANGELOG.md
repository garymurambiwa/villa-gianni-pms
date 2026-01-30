# Changelog

## [0.3.0] - 2026-01-14
- POS persistence: transactional UPSERTs and table status tracking
- Debounced auto-save in POSFrontOffice; 90s mount timeout compliance
- Room type dropdown auto-refresh via rate plan subscriptions
- Version injection: __APP_VERSION__ in UI and tests
- Electron builder outputs to release_v0.3.0 with checksums
- CI updated to build on release/* branches

## [0.2.9] - 2026-01-09
- Network-ready database: 0.0.0.0 binding, firewall rule for 54320
- Real-time dashboard occupancy updates with low latency
- Packaging improvements and installer checksum verification
