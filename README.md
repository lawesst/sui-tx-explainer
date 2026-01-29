# Sui Transaction Explainer

A user-friendly web application that translates Sui transaction data into clear, human-readable explanations. Instead of raw transaction blocks and object data, users see plain-English summaries of on-chain activity.

## Overview

The Sui Transaction Explainer converts low-level Move execution data into semantic actions, making blockchain transactions accessible to users, developers, educators, and DAO reviewers. The application fetches transaction data from Sui networks and presents it in an intuitive, easy-to-understand format.

## Features

- **Human-Readable Explanations**: Converts raw transaction data into plain English
- **Transaction Classification**: Automatically identifies and categorizes actions:
  - Coin transfers (SUI and other coin types)
  - NFT transfers
  - Object transfers
  - Contract calls
  - Staking operations
- **Gas Cost Breakdown**: Displays computation costs, storage costs, and storage rebates
- **Copyable Addresses**: Click any address to copy it to clipboard
- **Shareable Links**: Generate shareable URLs for transaction explanations
- **Sui Theme**: Styled with modern design language
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Blockchain**: Sui Mainnet
- **SDK**: @mysten/sui

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Sui Mainnet RPC endpoint (optional, defaults to public mainnet RPC)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/lawesst/sui-tx-explainer.git
cd sui-tx-explainer
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the project root (optional):
```bash
SUI_RPC=https://fullnode.mainnet.sui.io:443
```

**Note:** This application is configured for **Sui Mainnet** by default. If not provided, it will use the public Sui Mainnet RPC endpoint. For custom RPC providers (like Alchemy), set your mainnet endpoint in `.env.local`.

4. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Paste a Sui transaction digest (or Sui Explorer link) into the input field
2. Click "Explain transaction" to fetch and analyze the transaction
3. View the human-readable explanation, including:
   - Transaction status and summary
   - List of actions performed
   - Gas cost breakdown (computation, storage, rebate)
4. Share the explanation using the generated shareable link

## Project Structure

```
sui-tx-explainer/
├── src/
│   └── app/
│       ├── api/
│       │   └── explain/
│       │       └── [txHash]/
│       │           └── route.ts    # API endpoint for transaction explanation
│       ├── page.tsx                 # Main UI component
│       ├── layout.tsx               # Root layout
│       └── globals.css              # Global styles
├── public/                          # Static assets
├── .env.local                       # Environment variables (not committed)
└── package.json                     # Dependencies
```

## API Endpoint

### GET `/api/explain/[txDigest]`

Fetches and explains a Sui transaction.

**Parameters:**
- `txDigest` (path): The transaction digest (64-character hex string)

**Response:**
```json
{
  "txDigest": "...",
  "status": "success" | "reverted" | "pending_or_unknown",
  "summary": {
    "from": "0x...",
    "gasUsed": {
      "computationCost": "...",
      "storageCost": "...",
      "storageRebate": "...",
      "total": "..."
    }
  },
  "transfers": {
    "coins": [...]
  },
  "actions": [...],
  "actionExplanations": ["Alice sent 10 SUI to Bob", ...],
  "raw": {
    "transaction": {...}
  }
}
```

## Architecture

### Transaction Processing Flow

1. **Validation**: Validates the transaction digest format
2. **Data Fetching**: Retrieves transaction block data via Sui RPC
3. **Transfer Parsing**: Extracts coin transfers from transaction events
4. **Action Classification**: Classifies actions using rules-based logic
5. **Explanation Generation**: Generates human-readable explanations with:
   - Coin types and amounts
   - Known contract names
   - Address formatting

### Explanation Engine

The explanation engine uses a rules-based approach to classify transactions:

- **Coin Transfers**: Detected via Transfer events
- **NFT Transfers**: Identified by object transfer patterns
- **Contract Calls**: Detected from transaction kind
- **Staking**: Identified by staking-specific operations

## Known Limitations

- Coin symbols require manual configuration in `KNOWN_COINS` mapping
- Contract names require manual configuration in `KNOWN_CONTRACTS` mapping
- Complex multi-object transactions may show simplified explanations
- ENS resolution is not yet implemented (addresses shown as shortened)

## Development

### Building for Production

```bash
npm run build
npm start
```

### Linting

```bash
npm run lint
```

## Deployment

The application can be deployed to any platform that supports Next.js:

- **Vercel**: Recommended for Next.js applications
- **Netlify**: Supports Next.js with minimal configuration
- **Self-hosted**: Run `npm run build` and `npm start`

Ensure environment variables are configured in your deployment platform if using custom RPC endpoints.

## Contributing

Contributions are welcome. Please ensure:

1. Code follows existing patterns and conventions
2. TypeScript types are properly defined
3. UI components maintain consistent styling
4. New features include appropriate error handling

## License

This project is open source and available for use and modification.

## Acknowledgments

Built for the Sui ecosystem to improve transaction comprehension and accessibility.
