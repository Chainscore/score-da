# FGCS submission package

This folder holds the version of the paper for *Future Generation Computer Systems* (Elsevier). `../paper-latex/` (IEEE format) is unchanged.

- **Format:** elsarticle 5p double-column. It compiles to **18 pages including references**, exactly the journal's hard limit.
- **Build:** `pdflatex main && bibtex main && pdflatex main && pdflatex main`
  - `elsarticle.cls` and `elsarticle-num.bst` are bundled here, so any free TeX install (MacTeX, TeX Live) or a free Overleaf account can build it with nothing extra to install.
- **CHECK markers:** all `[CHECK]` markers are resolved. The last open item is the Zenodo DOI placeholder `ZENODO_DOI`, which is filled in once the release is archived.

## Publishing at zero cost

- **FGCS:** submit as a **subscription** article. When asked about open access, choose "subscription". This has no fee. (The gold open-access option charges an APC.)
- **Open access:** comes for free through:
  - the arXiv preprint (`./make_arxiv.sh`, cs.DC cross-listed to cs.CR), and
  - Elsevier's free SSRN preprint option, which you can tick during submission.
  - Elsevier's sharing policy allows both.
- **Archive and DOI:** Zenodo through GitHub integration (free).

## How each CHECK marker was resolved

| Marker | Resolution | Source |
|---|---|---|
| Tiramisu third layer "Cocoa" vs "Ladyfinger" | **Cocoa** (CDN). "Ladyfinger" appears in no Espresso source. The product is now called EspressoDA. | ePrint 2024/1189; Espresso HackMD |
| NEAR block time 0.6 s vs 1 s | **~0.6 s** (measured 0.616 s in the window; live since May 2025). The 5-epoch garbage-collection window is therefore **~1.5 days**, not 2.5. Max transaction size is 1.5 MiB. | nearcore 2.6/2.7 releases; RPC at in-window heights |
| Avail max block 4 vs 64 MiB | **4 MiB** throughout the window. 64 MiB is only the node software's ceiling. | Avail chain state at in-window heights |
| Ethereum custody 4 vs 8 | **Both are right.** CUSTODY_REQUIREMENT = 4 groups per node; VALIDATOR_CUSTODY_REQUIREMENT = 8, plus 1 per 32 ETH; SAMPLES_PER_SLOT = 8. The text now states all three. | consensus-specs `fulu/das-core.md` |
| Cost table mixed quantile bases | **Recomputed for every protocol on one basis:** quantiles of daily median $/MiB, and VWAP = total spend / total volume. | `protocol/*/analysis/daily*.csv` |
| Celestia utilization > 100% | **The capacity denominator was wrong**, see below. | celestia-app state; CIP-036 |
| "Jupyter notebooks" | The text now says scripts; the repo has no notebooks. | repo |
| CRediT roles | Kept as drafted. Edit them if they're wrong. | — |
| Competing interests | **Now declared:** Chainscore builds Polkadot/JAM software and lists W3F, Polkadot and NEAR as partners (from chainscorelabs.com). | chainscorelabs.com |
| Funder role | Standard W3F statement kept. | — |
| Generative-AI declaration | Extended to cover Claude Code, which the repo's `.claude/` agents show was used for scripts and analysis. | repo |
| Zenodo DOI | Pending the GitHub release (see the checklist). | — |

The full research notes behind these answers are in `FACTS.md`.

## Data corrections that change results

### Ethereum (`protocol/Ethereum/data/transform_corrected.py`)

- **What was wrong:**
  - The BPO2 start was a placeholder (block 24.5M), so BPO2 was never applied in the window.
  - The Pectra start was a placeholder.
  - Fusaka was missing.
  - Cost was reported in $/MiB/day as if it were $/MiB.
- **Fix:** era boundaries now come from the fork activation slots.
- **New results:**
  - median **$0.0073/MiB**
  - mean utilization **35%** (60 / 58 / 31 / 23% across the Pectra / Fusaka / BPO1 / BPO2 eras)
  - the fee left the 1-wei floor at **Fusaka (EIP-7918, 3 Dec)**, before any capacity increase

### Celestia (`protocol/Celestia/analysis/daily_corrected.csv`)

- **What was wrong:** the transform assumed a 2 MiB maximum before 24 Nov and 8 MiB after. In reality:
  - the maximum square was 128 (8 MiB) until 3 Dec 2025,
  - from 3 Dec it was **256 (32 MiB)**, set by a parameter change after app v6, and
  - block time was 6.03 s.
- **Effect on utilization:**
  - The 16–21 Dec surge peaks at **~22%** of capacity, not ">100%".
  - Steady state is about 0.3–1%; the window mean is 1.7%.
  - The narrative is now "capacity was quadrupled two weeks before the largest demand surge, which was absorbed without any fee response".
- **Sampling window:** **7 days (CIP-036)**, not 30.

### Retention, which changes finding (iv)

| Protocol | Retention | Basis |
|---|---|---|
| Polkadot | 25 h | `KEEP_FINALIZED_FOR_LIVE_NETWORKS = 25` in polkadot-sdk |
| NEAR | ~1.5 d | 5 epochs × 43,200 blocks × 0.6 s |
| Celestia | 7 d | sampling window |
| Ethereum | ~18 d | 4,096 epochs |
| **Avail** | **No protocol expiry** | The old "85 min" was *state* pruning after 256 blocks. Block data is kept by default (Substrate `--blocks-pruning archive-canonical`). |
| **Espresso** | **Set per node** | Pruning is off by default; when enabled the target is 7 d. |

- **Annualized cost now covers only the four protocols with a defined window:** NEAR ~$129, Celestia ~$1.0, Ethereum ~$0.15 and Polkadot ~$0.002 per MiB per year.
- **New headline:** "protocol-defined retention ranges from 25 h (Polkadot) to ~18 d (Ethereum), and Avail and Espresso leave retention to node operators".

## Figures

Regenerate them with:
```
cd ../protocol
FGCS_COMPACT=1 python3 <Proto>/analysis/plot.py            # Avail Celestia Near Polkadot Espresso
FGCS_COMPACT=1 python3 Ethereum/analysis/plot_fgcs.py
FGCS_COMPACT=1 python3 shared/cross_protocol_fgcs.py
```
- **Before running:** copy `figure-scripts/cross_protocol_fgcs.py` to `protocol/shared/` and `figure-scripts/plot_fgcs.py` to `protocol/Ethereum/analysis/`, then apply `figure-scripts/plot_style.patch`.
- **Known bug:** `shared/cross_protocol_plot.py` uses lowercase paths, which fail in the Linux Docker image.

## Submission checklist

- [ ] Archive on Zenodo:
  1. Sign in to Zenodo with GitHub.
  2. Turn on `Chainscore/score-da`.
  3. Publish GitHub release `v1.0.0`.
  4. Replace `ZENODO_DOI` in `main.tex` and `CITATION.cff`, then rebuild.
- [ ] Make the corresponding author's ORCID record public (0009-0007-4742-9153). FGCS requires it.
- [ ] Post the arXiv preprint with `./make_arxiv.sh`. The first submission may need an endorsement.
- [ ] Upload to Editorial Manager:
  - choose the **subscription** (no-fee) option
  - LaTeX source and figures (each figure as a separate file)
  - `submission/highlights.txt` and `submission/cover_letter.txt`
  - a declaration of interests (.docx, from Elsevier's declarations tool)
  - author bios with photos (`submission/vitae_template.txt`)
