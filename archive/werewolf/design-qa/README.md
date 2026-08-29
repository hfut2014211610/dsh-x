# Werewolf Signal Circle design QA

## Inputs

- [Reference](./reference.png)
- [Night implementation](./implementation-night.png)
- [Seer finding implementation](./implementation-seer-finding.png)
- [Night comparison](./comparison-night.png)
- [Seer finding comparison](./comparison-seer-finding.png)
- Browser viewport: 1280 × 720 CSS pixels at device scale 1.
- The 1672 × 941 reference was normalized to 1280 × 720 for the comparisons; implementation captures use a native 1280 × 720 viewport.

## States reviewed

- First-night Seer action with all seven neutral seat sigils visible.
- Day discussion after a Seer inspection, with one known seat and the private finding detail open.
- Seat-level `查看发现`, finding-list `查验`, detail switching, and `返回我的身份` interactions.
- The 820px and 390px DOM states remained covered by responsive snapshots; this review judged the rendered 1280px desktop surface.

## Comparison history

1. The first implementation used light host surfaces during night, a 460px circle, and a sticky action form that covered the lower seats at 720px. This failed the layout comparison.
2. The night palette moved to navy surfaces, the circle became 330px, and the action form changed to normal scroll flow below 900px. All seven seats then remained visible above the host composer.
3. The game gained the bounded Signal Circle header, neutral per-seat sigils, and a private findings rail. The first known-seat control collided with an adjacent seat, so the duplicate `已知` line was removed and `查看发现` became the single bordered seat action with explicit stacking.
4. The final browser pass opened the Seer finding from both entry points and confirmed target, localized faction, source day, and return navigation.

## Final assessment

- P0: none.
- P1: none.
- P2: none. The reference includes a richer multi-day phase rail and an exit control that the authorized view did not provide; the implementation did not invent either behavior. The host composer occupies its normal shell layer, while the plugin action form remains reachable in the content scroll flow at 720px.
- Visual result: passed.
