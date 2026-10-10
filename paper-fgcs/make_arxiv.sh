#!/usr/bin/env bash
# Build an arXiv-ready source tarball from paper-fgcs/.
# Refuses to run while any \authorcheck{...} marker remains (pass --draft to override).
set -euo pipefail
cd "$(dirname "$0")"
if [[ "${1:-}" != "--draft" ]]; then
  if grep -n '\\authorcheck{' main.tex sections/*.tex | grep -v 'newcommand'; then
    echo "Resolve the \\authorcheck markers above first (or run with --draft)." >&2; exit 1
  fi
fi
pdflatex -interaction=nonstopmode main >/dev/null
bibtex main >/dev/null
pdflatex -interaction=nonstopmode main >/dev/null
pdflatex -interaction=nonstopmode main >/dev/null
OUT=arxiv-${1:+draft-}$(date +%Y%m%d).tar.gz
OUT=${OUT/--draft-/draft-}
# arXiv needs the .bbl (it does not run bibtex reliably); figures are vector PDFs.
tar czf "$OUT" main.tex main.bbl elsarticle.cls sections/*.tex figures/*.pdf
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1)). Upload under cs.DC (cross-list cs.CR)."
