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
};

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// MVP hardcoded metadata for nicer explanations.
// NOTE: addresses should be all lowercased for matching.
const KNOWN_TOKENS: Record<
  string,
  { symbol: string; decimals: number }
> = {
  // Example: USDC on Arbitrum Sepolia (replace with real addresses as needed)
  // "0x...": { symbol: "USDC", decimals: 6 },
};

const KNOWN_CONTRACTS: Record<string, string> = {
  // "0x...uniswap_v3_pool": "Uniswap V3 Pool",
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
  return logs
    .filter((log) => log.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC)
    .map((log) => {
      const from = `0x${log.topics[1]?.slice(26) ?? ""}`;
      const to = `0x${log.topics[2]?.slice(26) ?? ""}`;
      const valueRaw = log.data || "0x0";

      return {
        tokenContract: log.address,
        from,
        to,
        valueRaw,
      };
    });
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

  // Token transfers (currently treating them as ERC20 transfers).
  for (const transfer of tokenTransfers) {
    const amount = hexToDecimalString(transfer.valueRaw);
    const description = `sent ${amount} tokens`;

    actions.push({
      type: "ERC20_TRANSFER",
      description,
      from: transfer.from,
      to: transfer.to,
      tokenContract: transfer.tokenContract,
      amount,
    });
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

// Placeholder for ENS / more advanced resolution in the future.
function resolveDisplayName(addr?: string | null): string {
  if (!addr) return "unknown";
  // ENS resolution could go here (async). For MVP we keep it synchronous.
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

    const totalFeeWei =
      receipt?.gasUsed && effectiveGasPrice
        ? BigInt(receipt.gasUsed) * BigInt(effectiveGasPrice)
        : BigInt(0);

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


