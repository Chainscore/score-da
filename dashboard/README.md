# DA Protocol Benchmarking Dashboard

An interactive web dashboard for visualizing and comparing Data Availability (DA) protocol performance metrics.

## Features

- 📊 **Interactive Charts**: Bar charts, line charts, and radar charts for comprehensive data visualization
- 🎯 **Key Metrics**: Quick overview of best performers across throughput, TPS, cost, and latency
- 📈 **Trend Analysis**: Time-series data visualization showing performance over time
- 🔍 **Protocol Comparison**: Side-by-side comparison of all DA protocols
- 🎨 **Modern UI**: Built with Next.js 15, TypeScript, and Tailwind CSS

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Icons**: Lucide React
- **Build Tool**: Turbopack

## Getting Started

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
dashboard/
├── app/
│   ├── layout.tsx          # Root layout with metadata
│   ├── page.tsx            # Main dashboard page
│   └── globals.css         # Global styles
├── components/
│   └── ui/
│       └── card.tsx        # Reusable Card component
├── lib/
│   ├── utils.ts            # Utility functions
│   └── constants.ts        # Protocol colors and constants
└── public/                 # Static assets
```

## Data Source

The dashboard consumes data from the `/results` directory:

- `performance-metrics.json` - Core performance data (throughput, TPS, cost, latency)
- `efficiency-metrics.json` - Efficiency analysis (storage, proofs, latency scores)
- `time-series-data.json` - 30-day trend data
- `worst-case-analysis.json` - Stress test scenarios
- `security-validator-data.json` - Security assumptions and validator costs

## Protocols Covered

- **Polkadot** (ELVES) - #E6007A
- **Celestia** - #7B2BF9
- **Espresso** (Tiramisu) - #FF6B35
- **NEAR** - #00C08B
- **Avail** - #2E5CFF

## License

Part of the DA-Research project by Chainscore Labs

