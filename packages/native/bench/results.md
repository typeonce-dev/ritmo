# Native movement benchmark

2026-10-18T05:40:34.350Z — AMD EPYC 9V74 80-Core Processor, linux, Node v24.19.0.

Minimum of 15 timed batches after 5 warm-up batches; 20 simulation ticks per batch. Setup, rendering and snapshots are excluded. Node and interpreted QuickJS use the original object-storage bundle; the native run must execute C kernels. This measures numeric movement, not the entire top-down game.

| Entities | Node JIT ms/frame | QuickJS interpreted ms/frame | Native C ms/frame |
| --- | ---: | ---: | ---: |
| 1000 | 0.0489 | 1.2370 | 0.0344 |
| 5000 | 0.2712 | 6.7541 | 0.0817 |
| 10000 | 0.4263 | 17.4527 | 0.1416 |

Reproduce: `node --import tsx scripts/native-bench.ts`. Results compare only on this machine.

## Browser-path regression checks

The final same-machine check passed with every runtime difference within 20%.
Type-checker types increased 3.4% and instantiations 2.0%, within the committed
5% tolerance. The pre-change measurements are in `browser-before.json`; the
final output is in `browser-comparison.txt`.

The plain `pnpm bench:check` also ran. It flagged six runtime cases when comparing
this AMD Linux machine against the shared Apple M1 baseline. Several cases
already exceeded that baseline in the pre-change measurement. Its complete
output is in `browser-baseline-check.txt`; the shared baseline was not updated.
Use `pnpm bench:check --compare packages/native/bench/browser-before.json` to
repeat the same-machine comparison on this host. Measurements from a different
machine need a new baseline from the pre-change commit.
