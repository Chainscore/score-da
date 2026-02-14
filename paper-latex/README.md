# Paper (LaTeX)

IEEE-format paper. Compiled with `pdflatex` + `bibtex`.

## Build

```bash
cd paper-latex
pdflatex main.tex && bibtex main && pdflatex main.tex && pdflatex main.tex
```

Or use your LaTeX editor's build command.

## Structure

```
paper-latex/
├── main.tex            # Entry point
├── references.bib      # Bibliography
├── sections/
│   ├── introduction.tex
│   ├── background.tex
│   ├── architecture.tex
│   ├── methodology.tex
│   ├── results.tex
│   ├── discussion.tex
│   ├── security.tex
│   └── conclusion.tex
└── figures/            # Chart PNGs from protocol analysis
```
