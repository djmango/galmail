# Tauri Risk Prototypes (GalMail)

Prototypes required before committing hard to the shell. Status reflects this repository’s scaffolding.

| Risk area | Goal | Status | Notes / blocker |
|-----------|------|--------|-----------------|
| iOS notification service extension | Enrich APNs with local ciphertext lookup | **Scaffolded (Swift stub)** | Tauri 2 iOS + NSE App Group wiring is the highest-risk path; needs Xcode project validation on device |
| Actionable notification categories | Archive / read / delete / reply from lock screen | **Scaffolded** | Requires thin Swift plugin + Tauri command bridge; untested on device |
| Suspended-app delta fetch | Background sync without full UI | **Documented stub** | iOS BGTaskScheduler limits; may need silent push + short wake |
| Million-message encrypted storage/search | SQLCipher + FTS budgets | **Rust core stubs + fixture generator** | Needs real SQLCipher integration + hardware bench |
| macOS keyboard / focus | Superhuman-speed shortcuts in WKWebView | **Web keyboard package + Tauri window focus notes** | Verify key capture vs system shortcuts |
| Browser quota / eviction | OPFS recovery after eviction | **Adapter stubs** | Need quota exceeded recovery UX tests |

## Prototype checklist

- [ ] Build Tauri iOS target with App Group shared container
- [ ] NSE loads encrypted index key from Keychain access group
- [ ] Actionable notifications call into Rust outbox via app wake
- [ ] Suspended delta fetch respects battery/network policies
- [ ] 100k fixture search < 100 ms on M-series Mac
- [ ] Browser eviction shows re-link / re-hydrate flow

## Decision gate

If NSE + actionable notifications cannot meet privacy constraints (no plaintext to APNs payload), keep **generic/delayed blind notifications** as the default and document the UX tradeoff in settings (already planned).
