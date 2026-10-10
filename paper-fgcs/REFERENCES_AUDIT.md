# Bibliography audit (10 Oct 2026)

`references.bib` here replaces `paper-latex/references.bib` for the FGCS version.

- **Keys:** all original keys are kept, plus 15 new peer-reviewed entries with DOIs.
- **Verification sources:** Crossref, arXiv, IACR ePrint and eips.ethereum.org.
- **Uncited entries:** entries that are not `\cite`d are dropped by BibTeX automatically. Docs pages and Gate.io are no longer cited.

## Fixed entries

| Key | Fix |
|---|---|
| `CodexDAS` | The placeholder ("Journal of Research", first names only) is replaced with the real paper: Chaudhuri, Basak, Kiraly, Ryajov, Bautista-Gomez, *On the Design of Ethereum's Data Availability Sampling*, IEEE BRAINS 2024, doi:10.1109/BRAINS63024.2024.10732486. |
| `AlBassam_FraudDA` | Now the peer-reviewed FC 2021 version (LNCS 12675, pp. 279–298, doi:10.1007/978-3-662-64331-0_15). It adds a 4th author, so the text now reads "Al-Bassam et al.". |
| `Jeff_Burdges_ELVES` | Year corrected from 2019 to 2024 (ePrint 2024/961). Full 9-author list; text now reads "Burdges et al.". |
| `Espresso:Hotshot_and_Triamisu` | Now ePrint 2024/1189 with the 16 real authors (Bearer et al.). |
| `Overview_of_polkadot` | arXiv:2005.13456, with author typos fixed. |
| `Saif_Survey_DA_Rollups` | Added Future Internet 16(9):315, doi:10.3390/fi16090315. |
| `KZG_Original` | Added doi:10.1007/978-3-642-17373-8_11. |
| EIPs (4844, 7691, 7594, 7918, 1559) | Real author lists, creation years and eips.ethereum.org URLs. |
| Avail entries | @article changed to @misc; fake volume/number removed. |
| Docs URLs | Redirected URLs updated. |

## Removed from the text

- **`Espresso_ITCS_2026` ("bribery-resistant VID, ITCS 2026"):** not in the ITCS 2026 accepted-papers list, Crossref, arXiv or ePrint. The claim and citation are removed. If you have the paper, add it back with real authors.
- **Symbolic Capital and Gate.io blog posts:** replaced with peer-reviewed surveys.

## New references (all cited in Section 2.4 or 2.2)

| Key | Venue |
|---|---|
| `Reed1960RS` | Reed and Solomon, J. SIAM 1960 |
| `Cachin2005AVID` | Cachin and Tessaro, SRDS 2005 |
| `Croman2016Scaling` | Croman et al., FC 2016 workshops |
| `Yu2020CodedMerkle` | Yu et al., FC 2020 |
| `Sheng2021ACeD` | Sheng et al., FC 2021 |
| `Nazirkhanova2022VID` | Nazirkhanova, Neu and Tse, AFT 2022 |
| `HallAndersen2024FRIDA` | Hall-Andersen, Simkin and Wagner, CRYPTO 2024 |
| `HallAndersen2025FoundationsDAS` | Hall-Andersen, Simkin and Wagner, IACR CiC 2025 |
| `Thibault2022Rollups` | Thibault, Sarry and Hafid, IEEE Access 2022 |
| `Fisch2025PermissionlessVID` | Fisch et al., IEEE S&P 2025 |
| `Pigaglio2025PANDAS` | Pigaglio et al., Middleware 2025 |
| `Crapis2024EIP4844Econ` | Crapis et al., FC 2024 workshops |
| `Heimbach2025BlobFee` | Heimbach et al., FC 2025 |
| `Park2026EIP4844Impact` | Park et al., IEEE TNSE 2026 |
| `Lee2025BlobSharing` | Lee et al., ICDCSW 2025 |

**Please skim each new paper.** I described them in one line each from their abstracts and metadata, so confirm each characterization before you submit.

## Still open

- **Avail sources:** the whitepaper's real title is only "Avail Whitepaper". No document called "A Unifying Blockchain Network" was found. Check the PDF and cite it once under its real title.
- **Preprints without a peer-reviewed version:** ELVES, the Polkadot overview, LazyLedger and the Espresso ePrint. These are acceptable, but they are marked as preprints.
