# Arbitrum Transaction Explainer

A user-friendly web application that translates Arbitrum transaction data into clear, human-readable explanations. Instead of raw logs and hexadecimal data, users see plain-English summaries of on-chain activity.

## Overview

The Arbitrum Transaction Explainer converts low-level EVM execution data into semantic actions, making blockchain transactions accessible to users, developers, educators, and DAO reviewers. The application fetches transaction data from Arbitrum networks and presents it in an intuitive, easy-to-understand format.

## Features

- **Human-Readable Explanations**: Converts raw transaction data into plain English
- **Transaction Classification**: Automatically identifies and categorizes actions:
  - ERC-20 token transfers
  - ERC-721 NFT transfers
  - ERC-1155 multi-token transfers
  - Contract interactions
- **Gas Cost Breakdown**: Displays L2 execution costs and L1 calldata fees
- **Copyable Addresses**: Click any address to copy it to clipboard
- **Shareable Links**: Generate shareable URLs for transaction explanations
- **Arbitrum Theme**: Styled with Arbitrum's brand colors and design language
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Blockchain**: Arbitrum (Sepolia testnet or Mainnet)
- **RPC Provider**: Alchemy

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- An Alchemy API key (for Arbitrum RPC access)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/lawesst/arbitrum-tx-explainer.git
cd arbitrum-tx-explainer
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the project root:
```bash
ALCHEMY_API_KEY=your_alchemy_api_key
ARBITRUM_RPC=https://arb-sepolia.g.alchemy.com/v2/your_alchemy_api_key
```

For Arbitrum Mainnet, use:
```bash
ARBITRUM_RPC=https://arb-mainnet.g.alchemy.com/v2/your_alchemy_api_key
```

4. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Paste an Arbitrum transaction hash (or Arbiscan link) into the input field
2. Click "Explain transaction" to fetch and analyze the transaction
3. View the human-readable explanation, including:
   - Transaction status and summary
   - List of actions performed
   - Gas cost breakdown
4. Share the explanation using the generated shareable link

## Project Structure

```
arbitrum-tx-explainer/
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

### GET `/api/explain/[txHash]`

Fetches and explains an Arbitrum transaction.

**Parameters:**
- `txHash` (path): The transaction hash (0x-prefixed hex string)

**Response:**
```json
{
  "txHash": "0x...",
  "status": "success" | "reverted" | "pending_or_unknown",
  "summary": {
    "from": "0x...",
    "to": "0x...",
    "nativeValueWei": "...",
    "gasUsed": "...",
    "effectiveGasPriceWei": "...",
    "totalFeeWei": "..."
  },
  "transfers": {
    "native": { "from": "0x...", "to": "0x...", "valueWei": "0x..." },
    "tokens": [...]
  },
  "actions": [...],
  "actionExplanations": ["Alice sent 250 USDC to Bob", ...],
  "raw": {
    "transaction": {...},
    "receipt": {...}
  }
}
```

## Architecture

### Transaction Processing Flow

1. **Validation**: Validates the transaction hash format
2. **Data Fetching**: Retrieves transaction and receipt data via RPC calls
3. **Transfer Parsing**: Extracts native ETH and token transfers from logs
4. **Action Classification**: Classifies actions using rules-based logic (no AI)
5. **Explanation Generation**: Generates human-readable explanations with:
   - Token symbols and decimals
   - Known contract names
   - Address formatting

### Explanation Engine

The explanation engine uses a rules-based approach to classify transactions:

- **ERC-20 Transfers**: Detected via Transfer event logs
- **ERC-721/ERC-1155 Transfers**: Identified by token transfer patterns
- **Contract Calls**: Detected when `to` address is not null and contains calldata

## Known Limitations

- Token symbols require manual configuration in `KNOWN_TOKENS` mapping
- Contract names require manual configuration in `KNOWN_CONTRACTS` mapping
- ENS resolution is not yet implemented (addresses shown as shortened)
- Complex multi-hop transactions may show simplified explanations

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

Ensure environment variables are configured in your deployment platform.

## Contributing

Contributions are welcome. Please ensure:

1. Code follows existing patterns and conventions
2. TypeScript types are properly defined
3. UI components maintain the Arbitrum theme
4. New features include appropriate error handling

## License

This project is open source and available for use and modification.

## Acknowledgments

Built for the Arbitrum ecosystem to improve transaction comprehension and accessibility.
