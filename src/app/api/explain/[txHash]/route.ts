import { NextResponse } from "next/server";

type RouteParams = {
  params: {
    txHash: string;
  };
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
};

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: JsonRpcError;
};

type RpcTransaction = {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  input: string;
  nonce: string;
  gas: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  blockNumber: string | null;
};

type RpcLog = {
  address: string;
  topics: string[];
  data: string;
};

type RpcReceipt = {
  transactionHash: string;
  status: string | null;
  gasUsed: string;
  effectiveGasPrice?: string;
  l1Fee?: string; // Arbitrum L1 fee
  l1GasPrice?: string;
  l1GasUsed?: string;
  logs: RpcLog[];
};

type ActionType =
  | "ERC20_TRANSFER"
  | "ERC721_TRANSFER"
  | "ERC1155_TRANSFER"
  | "CONTRACT_CALL";

export type Action = {
  type: ActionType;
  description: string;
  from?: string;
  to?: string | null;
  tokenContract?: string;
  tokenId?: string;
  amount?: string;
};

type NativeTransfer = {
  from: string;
  to: string | null;
  valueWei: string;
};

type TokenTransfer = {
  tokenContract: string;
  from: string;
  to: string;
  valueRaw: string;
  tokenId?: string;
  transferType: "ERC20" | "ERC721" | "ERC1155";
};

// Event topic signatures
const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ERC1155_TRANSFER_SINGLE_TOPIC =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const ERC1155_TRANSFER_BATCH_TOPIC =
  "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

// Known tokens on Arbitrum (addresses should be all lowercased for matching)
const KNOWN_TOKENS: Record<
  string,
  { symbol: string; decimals: number }
> = {
  // Arbitrum Mainnet
  "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": { symbol: "USDC", decimals: 6 },
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": { symbol: "USDT", decimals: 6 },
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": { symbol: "DAI", decimals: 18 },
  "0x82e3a8f066a698966b041031b8413507eb728e5c": { symbol: "WETH", decimals: 18 },
  "0x912ce59144191c1204e64559fe8253a0e49e6548": { symbol: "ARB", decimals: 18 },
  "0x539bde0d7dbd336b79148aa742883198bbf60342": { symbol: "MAGIC", decimals: 18 },
  "0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8": { symbol: "PENDLE", decimals: 18 },
  "0x4e352cf164e64adcbad318c3a1e222e9eba4ce42": { symbol: "MCB", decimals: 18 },
  "0x3d9907f9a368ad0a51be2f8d4b8e4507dfb52c6a": { symbol: "GMX", decimals: 18 },
  "0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a": { symbol: "GRAIL", decimals: 18 },
  
  // Arbitrum Sepolia (testnet)
  "0x75faf114eafb1bdbe2f0316df893fd58ce45aa4": { symbol: "USDC", decimals: 6 },
  "0x4d1493d3e0d448b6669e5a458182ea8c1a64f0e": { symbol: "WETH", decimals: 18 },
};

// Known contracts on Arbitrum (addresses should be all lowercased for matching)
const KNOWN_CONTRACTS: Record<string, string> = {
  // DEXs
  "0xc31e54c7a869b9fcbecc14363cf510d1c41fa443": "Uniswap V3 Router",
  "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3 Router 2",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap V3 Swap Router",
  "0x1b02da8cb0d097eb8d57a175b88c7d8b47997506": "SushiSwap Router",
  
  // Lending
  "0xa5edbdd9646f8dff606d7448e414884c7d905dca": "Aave V3 Pool",
  "0x794a61358d6845594f94dc1db02a252b5b4814ad": "Aave V3 Pool (Arbitrum)",
  
  // Bridges
  "0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef": "Arbitrum Bridge",
  "0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a": "Arbitrum Bridge (L1)",
  
  // Other
  "0x912ce59144191c1204e64559fe8253a0e49e6548": "Arbitrum Token (ARB)",
  "0x0000000000000000000000000000000000000064": "Arbitrum One L1 Gas Oracle",
};

async function callRpc<T>(payload: JsonRpcRequest): Promise<T> {
  const rpcUrl = process.env.ARBITRUM_RPC;

  if (!rpcUrl) {
    throw new Error("ARBITRUM_RPC is not configured in the environment.");
  }

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as JsonRpcResponse<T>;

  if (json.error) {
    throw new Error(
      `RPC error ${json.error.code}: ${json.error.message}${
        json.error.data ? ` (${JSON.stringify(json.error.data)})` : ""
      }`,
    );
  }

  if (typeof json.result === "undefined") {
    throw new Error("RPC response missing result");
  }

  return json.result;
}

function hexToDecimalString(hex: string | null | undefined): string {
  if (!hex) return "0";
  try {
    return BigInt(hex).toString(10);
  } catch {
    return "0";
  }
}

function parseTokenTransfers(logs: RpcLog[]): TokenTransfer[] {
  const transfers: TokenTransfer[] = [];

  for (const log of logs) {
    const topic0 = log.topics[0]?.toLowerCase();

    // ERC20 Transfer (3 topics: Transfer, from, to)
    if (topic0 === ERC20_TRANSFER_TOPIC && log.topics.length === 3) {
      const from = `0x${log.topics[1]?.slice(26) ?? ""}`;
      const to = `0x${log.topics[2]?.slice(26) ?? ""}`;
      const valueRaw = log.data || "0x0";

      transfers.push({
        tokenContract: log.address,
        from,
        to,
        valueRaw,
        transferType: "ERC20",
      });
    }
    // ERC721 Transfer (4 topics: Transfer, from, to, tokenId)
    else if (topic0 === ERC721_TRANSFER_TOPIC && log.topics.length === 4) {
      const from = `0x${log.topics[1]?.slice(26) ?? ""}`;
      const to = `0x${log.topics[2]?.slice(26) ?? ""}`;
      const tokenId = hexToDecimalString(log.topics[3]);

      transfers.push({
        tokenContract: log.address,
        from,
        to,
        valueRaw: "0x1", // ERC721 is always quantity 1
        tokenId,
        transferType: "ERC721",
      });
    }
    // ERC1155 TransferSingle
    else if (topic0 === ERC1155_TRANSFER_SINGLE_TOPIC && log.topics.length === 4) {
      const operator = `0x${log.topics[1]?.slice(26) ?? ""}`;
      const from = `0x${log.topics[2]?.slice(26) ?? ""}`;
      const to = `0x${log.topics[3]?.slice(26) ?? ""}`;

      // Decode data: id (uint256), value (uint256)
      const data = log.data || "0x";
      if (data.length >= 130) {
        const tokenId = hexToDecimalString("0x" + data.slice(2, 66));
        const valueRaw = "0x" + data.slice(66, 130);

        transfers.push({
          tokenContract: log.address,
          from,
          to,
          valueRaw,
          tokenId,
          transferType: "ERC1155",
        });
      }
    }
    // ERC1155 TransferBatch
    else if (topic0 === ERC1155_TRANSFER_BATCH_TOPIC && log.topics.length === 4) {
      const operator = `0x${log.topics[1]?.slice(26) ?? ""}`;
      const from = `0x${log.topics[2]?.slice(26) ?? ""}`;
      const to = `0x${log.topics[3]?.slice(26) ?? ""}`;

      // For batch transfers, create a simplified entry
      transfers.push({
        tokenContract: log.address,
        from,
        to,
        valueRaw: "0x1", // Placeholder for batch
        tokenId: "batch",
        transferType: "ERC1155",
      });
    }
  }

  return transfers;
}

type ClassifyInput = {
  transaction: RpcTransaction;
  receipt?: RpcReceipt | null;
  tokenTransfers?: TokenTransfer[];
};

// MVP, rules-based classification (no AI).
function classifyActions(data: ClassifyInput): Action[] {
  const actions: Action[] = [];

  const { transaction: tx, tokenTransfers = [] } = data;

  // Process token transfers by type
  for (const transfer of tokenTransfers) {
    if (transfer.transferType === "ERC20") {
      const amount = hexToDecimalString(transfer.valueRaw);
      actions.push({
        type: "ERC20_TRANSFER",
        description: `sent ${amount} tokens`,
        from: transfer.from,
        to: transfer.to,
        tokenContract: transfer.tokenContract,
        amount,
      });
    } else if (transfer.transferType === "ERC721") {
      actions.push({
        type: "ERC721_TRANSFER",
        description: `transferred NFT #${transfer.tokenId}`,
        from: transfer.from,
        to: transfer.to,
        tokenContract: transfer.tokenContract,
        tokenId: transfer.tokenId,
        amount: "1",
      });
    } else if (transfer.transferType === "ERC1155") {
      const amount = transfer.tokenId === "batch" 
        ? "multiple" 
        : hexToDecimalString(transfer.valueRaw);
      actions.push({
        type: "ERC1155_TRANSFER",
        description: transfer.tokenId === "batch"
          ? "transferred multiple NFTs"
          : `transferred NFT #${transfer.tokenId} (x${amount})`,
        from: transfer.from,
        to: transfer.to,
        tokenContract: transfer.tokenContract,
        tokenId: transfer.tokenId,
        amount,
      });
    }
  }

  // Contract interaction: to !== null (and has calldata).
  if (tx.to !== null) {
    const isContractCall = tx.input && tx.input !== "0x";

    if (isContractCall) {
      actions.push({
        type: "CONTRACT_CALL",
        description: `contract interaction with ${tx.to}`,
        from: tx.from,
        to: tx.to,
      });
    }
  }

  return actions;
}

// --- Explanation helpers ---

function shortenAddress(addr?: string | null): string {
  if (!addr) return "unknown";
  const a = addr.toLowerCase();
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

// ENS resolution cache (in-memory, resets on server restart)
const ensCache = new Map<string, string | null>();

// Resolve ENS name for an address (uses Ethereum mainnet ENS)
// Note: This is a placeholder. For production, implement proper ENS resolution using:
// - ethers.js with ENS resolver
// - The Graph's ENS subgraph
// - A dedicated ENS resolution service like 1inch's API
async function resolveENS(address: string): Promise<string | null> {
  if (!address || !address.startsWith("0x")) return null;

  const addrLower = address.toLowerCase();

  // Check cache first
  if (ensCache.has(addrLower)) {
    return ensCache.get(addrLower) ?? null;
  }

  try {
    // TODO: Implement proper ENS resolution
    // For now, return null (shortened address will be used)
    ensCache.set(addrLower, null);
    return null;
  } catch (error) {
    console.error(`ENS resolution failed for ${address}:`, error);
    ensCache.set(addrLower, null);
    return null;
  }
}

// Resolve display name (ENS or shortened address)
// Synchronous version for use in explain() function
function resolveDisplayName(addr?: string | null): string {
  if (!addr) return "unknown";
  // For now, return shortened address
  // Future: can be enhanced to batch-resolve ENS names
  return shortenAddress(addr);
}

function formatTokenAmount(
  tokenContract: string | undefined,
  rawAmount: string | undefined,
): { amount: string; symbol: string } {
  if (!rawAmount) {
    return { amount: "0", symbol: "tokens" };
  }

  const meta =
    tokenContract !== undefined
      ? KNOWN_TOKENS[tokenContract.toLowerCase()] ?? null
      : null;
  const decimals = meta ? meta.decimals : 18;
  const symbol = meta ? meta.symbol : "tokens";

  try {
    const raw = BigInt(rawAmount);
    const base = BigInt("1" + "0".repeat(decimals));
    const whole = raw / base;
    const frac = raw % base;

    if (frac === BigInt(0)) {
      return { amount: whole.toString(10), symbol };
    }

    // Simple decimal formatting with trimmed trailing zeros.
    const fracStr = frac.toString(10).padStart(decimals, "0").replace(/0+$/, "");
    return { amount: `${whole.toString(10)}.${fracStr}`, symbol };
  } catch {
    return { amount: hexToDecimalString(rawAmount), symbol };
  }
}

// MVP, rules-based explainer (no AI).
export function explain(action: Action): string {
  switch (action.type) {
    case "ERC20_TRANSFER": {
      const { amount, symbol } = formatTokenAmount(
        action.tokenContract,
        action.amount,
      );
      const fromName = resolveDisplayName(action.from);
      const toName = resolveDisplayName(action.to ?? undefined);
      return `${fromName} sent ${amount} ${symbol} to ${toName}`;
    }
    case "ERC721_TRANSFER": {
      const fromName = resolveDisplayName(action.from);
      const toName = resolveDisplayName(action.to ?? undefined);
      const id = action.tokenId ?? "unknown";
      return `NFT #${id} transferred from ${fromName} to ${toName}`;
    }
    case "ERC1155_TRANSFER": {
      const fromName = resolveDisplayName(action.from);
      const toName = resolveDisplayName(action.to ?? undefined);
      const id = action.tokenId ?? "unknown";
      const amount = action.amount ?? "1";
      return `NFT #${id} (x${amount}) transferred from ${fromName} to ${toName}`;
    }
    case "CONTRACT_CALL": {
      const target = action.to?.toLowerCase() ?? "";
      const knownName = KNOWN_CONTRACTS[target];
      const display = knownName ?? shortenAddress(action.to ?? undefined);
      return `User interacted with ${display}`;
    }
    default:
      return "Unrecognized action";
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  // Next.js 15+ may have params as a Promise
  const resolvedParams = await Promise.resolve(params);
  const { txHash: rawTxHash } = resolvedParams;

  // Debug logging
  console.log("[Explain API] Received rawTxHash:", rawTxHash);
  console.log("[Explain API] Type:", typeof rawTxHash);
  console.log("[Explain API] Length:", rawTxHash?.length);

  // 1. Extract and validate tx hash
  let txHash: string | null = null;

  if (typeof rawTxHash === "string") {
    // Best-effort: try to extract a well-formed hash from the string.
    const match = rawTxHash.match(/0x[0-9a-fA-F]{64}/);
    if (match) {
      txHash = match[0];
      console.log("[Explain API] Extracted hash via regex:", txHash);
    } else {
      // Fallback: if it starts with 0x and is long enough, slice the first 66 chars.
      const trimmed = rawTxHash.trim();
      if (trimmed.startsWith("0x") && trimmed.length >= 66) {
        txHash = trimmed.slice(0, 66);
        console.log("[Explain API] Extracted hash via slice:", txHash);
      }
    }
  }

  if (!txHash) {
    console.log("[Explain API] Failed to extract hash. Returning 400.");
    return NextResponse.json(
      {
        error: "Invalid transaction hash",
        details:
          "txHash must contain a 66-character 0x-prefixed hex string (32 bytes).",
        received: rawTxHash,
        debug: {
          type: typeof rawTxHash,
          length: rawTxHash?.length,
          value: rawTxHash,
        },
      },
      { status: 400 },
    );
  }

  try {
    const trimmedHash = txHash.trim();

    // 2. Fetch tx + receipt in parallel
    const [tx, receipt] = await Promise.all([
      callRpc<RpcTransaction>({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionByHash",
        params: [trimmedHash],
      }),
      callRpc<RpcReceipt>({
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getTransactionReceipt",
        params: [trimmedHash],
      }),
    ]);

    if (!tx) {
      return NextResponse.json(
        {
          error: "Transaction not found",
          details:
            "The transaction may not exist on this network or the RPC is pointing to the wrong chain.",
        },
        { status: 404 },
      );
    }

    // 3. Fetch transfers (native + tokens)
    const nativeTransfer: NativeTransfer = {
      from: tx.from,
      to: tx.to,
      valueWei: tx.value ?? "0x0",
    };

    const tokenTransfers = receipt?.logs
      ? parseTokenTransfers(receipt.logs)
      : [];

    // 4. Build explanation JSON
    const status =
      receipt?.status === "0x1"
        ? "success"
        : receipt?.status === "0x0"
          ? "reverted"
          : "pending_or_unknown";

    const gasUsed = hexToDecimalString(receipt?.gasUsed);
    const effectiveGasPrice = hexToDecimalString(
      receipt?.effectiveGasPrice ??
        tx.maxFeePerGas ??
        tx.gasPrice ??
        "0x0",
    );

    // Calculate L2 execution fee
    const l2FeeWei =
      receipt?.gasUsed && effectiveGasPrice
        ? BigInt(receipt.gasUsed) * BigInt(effectiveGasPrice)
        : BigInt(0);

    // Get L1 fee from receipt (Arbitrum-specific)
    const l1FeeWei = receipt?.l1Fee
      ? BigInt(receipt.l1Fee)
      : BigInt(0);

    // Calculate total fee
    const totalFeeWei = l2FeeWei + l1FeeWei;

    // Calculate L1 fee from calldata if not in receipt
    // Arbitrum L1 fee = (l1GasPrice * l1GasUsed) or from receipt.l1Fee
    let calculatedL1Fee = l1FeeWei;
    if (calculatedL1Fee === BigInt(0) && receipt?.l1GasPrice && receipt?.l1GasUsed) {
      const l1GasPrice = BigInt(receipt.l1GasPrice);
      const l1GasUsed = BigInt(receipt.l1GasUsed);
      calculatedL1Fee = l1GasPrice * l1GasUsed;
    }

    const actions = classifyActions({
      transaction: tx,
      receipt,
      tokenTransfers,
    });

    const explanation = {
      txHash: tx.hash,
      status,
      summary: {
        from: tx.from,
        to: tx.to,
        nativeValueWei: hexToDecimalString(tx.value),
        gasUsed,
        effectiveGasPriceWei: effectiveGasPrice,
        totalFeeWei: totalFeeWei.toString(10),
        l2FeeWei: l2FeeWei.toString(10),
        l1FeeWei: calculatedL1Fee.toString(10),
      },
      transfers: {
        native: nativeTransfer,
        tokens: tokenTransfers,
      },
      actions,
      actionExplanations: actions.map(explain),
      raw: {
        transaction: tx,
        receipt,
      },
    };

    return NextResponse.json(explanation);
  } catch (error) {
    console.error("Error explaining transaction:", error);

    return NextResponse.json(
      {
        error: "Failed to explain transaction",
        details:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 },
    );
  }
}


