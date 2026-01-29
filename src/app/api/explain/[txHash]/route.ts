import { NextResponse } from "next/server";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

type RouteParams = {
  params: Promise<{
    txHash: string;
  }>;
};

// Sui transaction types
type SuiTransactionBlock = {
  digest: string;
  transaction?: {
    data?: {
      messageVersion?: string;
      transaction?: {
        kind?: string;
        sender?: string;
        gasData?: {
          payment?: Array<{ objectId: string; version: string; digest: string }>;
          owner?: string;
          price?: string;
          budget?: string;
        };
      };
    };
  };
  effects?: {
    status?: {
      status?: string;
      error?: string;
    };
    gasUsed?: {
      computationCost?: string;
      storageCost?: string;
      storageRebate?: string;
    };
    transactionDigest?: string;
  };
  events?: Array<{
    type?: string;
    packageId?: string;
    transactionModule?: string;
    sender?: string;
    parsedJson?: unknown;
  }>;
  objectChanges?: Array<{
    type?: string;
    objectId?: string;
    objectType?: string;
    sender?: string;
    recipient?: string;
  }>;
};

type ActionType =
  | "COIN_TRANSFER"
  | "NFT_TRANSFER"
  | "OBJECT_CREATED"
  | "MOVE_CALL"
  | "CONTRACT_CALL"
  | "STAKING"
  | "SWAP";

export type Action = {
  type: ActionType;
  description: string;
  from?: string;
  to?: string | null;
  coinType?: string;
  amount?: string;
  objectId?: string;
};

type CoinTransfer = {
  coinType: string;
  from: string;
  to: string;
  amount: string;
};

// Known coins on Sui (package::module::CoinType)
const KNOWN_COINS: Record<string, { symbol: string; decimals: number }> = {
  "0x2::sui::SUI": { symbol: "SUI", decimals: 9 },
  "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN": {
    symbol: "USDC",
    decimals: 6,
  },
  "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN": {
    symbol: "USDT",
    decimals: 6,
  },
};

// Known contracts/packages on Sui
const KNOWN_CONTRACTS: Record<string, string> = {
  "0x2": "Sui Framework",
  "0x3": "DeepBook",
  "0x5": "Sui System",
};

// Initialize Sui client
function getSuiClient(network: "mainnet" | "testnet" | "devnet" = "mainnet"): SuiClient {
  const rpcUrl = process.env.SUI_RPC || getFullnodeUrl(network);
  return new SuiClient({ url: rpcUrl });
}

function hexToDecimalString(hex: string | null | undefined): string {
  if (!hex) return "0";
  try {
    return BigInt(hex).toString(10);
  } catch {
    return "0";
  }
}

function shortenAddress(addr?: string | null): string {
  if (!addr) return "unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatCoinAmount(
  coinType: string | undefined,
  rawAmount: string | undefined,
): { amount: string; symbol: string } {
  if (!rawAmount) {
    return { amount: "0", symbol: "coins" };
  }

  const meta = coinType ? KNOWN_COINS[coinType] ?? null : null;
  const decimals = meta ? meta.decimals : 9; // Default to SUI decimals
  const symbol = meta ? meta.symbol : "coins";

  try {
    const raw = BigInt(rawAmount);
    const base = BigInt("1" + "0".repeat(decimals));
    const whole = raw / base;
    const frac = raw % base;

    if (frac === BigInt(0)) {
      return { amount: whole.toString(10), symbol };
    }

    const fracStr = frac.toString(10).padStart(decimals, "0").replace(/0+$/, "");
    return { amount: `${whole.toString(10)}.${fracStr}`, symbol };
  } catch {
    return { amount: hexToDecimalString(rawAmount), symbol };
  }
}

function resolveDisplayName(addr?: string | null): string {
  if (!addr) return "unknown";
  return shortenAddress(addr);
}

// Parse coin transfers from Sui transaction events
function parseCoinTransfers(
  events: SuiTransactionBlock["events"] | null | undefined,
): CoinTransfer[] {
  const transfers: CoinTransfer[] = [];

  if (!events) return transfers;

  for (const event of events) {
    // Coin transfer events
    if (event.type?.includes("Transfer")) {
      const parsed = event.parsedJson as {
        amount?: string;
        coin_type?: string;
        recipient?: string;
        sender?: string;
      };

      if (parsed?.amount && parsed?.recipient) {
        transfers.push({
          coinType: parsed.coin_type || "0x2::sui::SUI",
          from: parsed.sender || "unknown",
          to: parsed.recipient,
          amount: parsed.amount,
        });
      }
    }
  }

  return transfers;
}

// Classify actions from Sui transaction
function classifyActions(
  tx: SuiTransactionBlock,
  coinTransfers: CoinTransfer[],
): Action[] {
  const actions: Action[] = [];

  // Process coin transfers
  for (const transfer of coinTransfers) {
    const { amount, symbol } = formatCoinAmount(transfer.coinType, transfer.amount);
    actions.push({
      type: "COIN_TRANSFER",
      description: `sent ${amount} ${symbol}`,
      from: transfer.from,
      to: transfer.to,
      coinType: transfer.coinType,
      amount: transfer.amount,
    });
  }

  // Detect object creation and transfers from objectChanges
  const objectChanges = tx.objectChanges || [];
  let createdCount = 0;
  let transferredCount = 0;
  const nftTransfers: Array<{ from: string; to: string; objectId: string; objectType?: string }> = [];

  for (const change of objectChanges) {
    if (change.type === "created") {
      createdCount++;
    } else if (change.type === "transferred") {
      transferredCount++;
      const transferred = change as any;
      if (transferred.objectType && transferred.objectType.includes("nft")) {
        nftTransfers.push({
          from: transferred.sender || "unknown",
          to: transferred.recipient || "unknown",
          objectId: transferred.objectId || "",
          objectType: transferred.objectType,
        });
      }
    }
  }

  // Add object creation summary
  if (createdCount > 0) {
    actions.push({
      type: "OBJECT_CREATED",
      description: `${createdCount} new object${createdCount > 1 ? "s were" : " was"} created`,
      from: tx.transaction?.data?.transaction?.sender || "unknown",
      to: null,
      amount: createdCount.toString(),
    });
  }

  // Add NFT transfers
  for (const nft of nftTransfers) {
    const objectIdShort = nft.objectId ? `#${nft.objectId.slice(0, 8)}` : "";
    actions.push({
      type: "NFT_TRANSFER",
      description: `NFT ${objectIdShort} transferred`,
      from: nft.from,
      to: nft.to,
      objectId: nft.objectId,
    });
  }

  // Extract Move call information
  const transactionData = tx.transaction?.data?.transaction;
  if (transactionData) {
    const kind = transactionData.kind;
    
    // Check for ProgrammableTransaction which contains Move calls
    if (kind && typeof kind === "object" && "ProgrammableTransaction" in kind) {
      const progTx = (kind as any).ProgrammableTransaction;
      const commands = progTx?.transactions || [];
      
      for (const cmd of commands) {
        if (cmd.MoveCall) {
          const moveCall = cmd.MoveCall;
          const packageId = moveCall.package || "unknown";
          const module = moveCall.module || "unknown";
          const functionName = moveCall.function || "unknown";
          
          // Shorten package ID for display
          const packageShort = packageId.length > 20 
            ? `${packageId.slice(0, 10)}...${packageId.slice(-6)}`
            : packageId;
          
          actions.push({
            type: "MOVE_CALL",
            description: `called ${module}::${functionName}`,
            from: transactionData.sender || "unknown",
            to: packageId,
            coinType: `${packageShort}::${module}::${functionName}`,
          });
        }
      }
    } else if (kind && kind !== "TransferObject") {
      // Generic contract interaction
      const sender = transactionData.sender;
      actions.push({
        type: "CONTRACT_CALL",
        description: `executed ${typeof kind === "string" ? kind : "transaction"}`,
        from: sender,
        to: null,
      });
    }
  }

  return actions;
}

// Generate human-readable explanation
export function explain(action: Action): string {
  switch (action.type) {
    case "COIN_TRANSFER": {
      const { amount, symbol } = formatCoinAmount(action.coinType, action.amount);
      const fromName = resolveDisplayName(action.from);
      const toName = resolveDisplayName(action.to ?? undefined);
      return `${fromName} transferred ${amount} ${symbol} to ${toName}`;
    }
    case "NFT_TRANSFER": {
      const fromName = resolveDisplayName(action.from);
      const toName = resolveDisplayName(action.to ?? undefined);
      const objectId = action.objectId ? `#${action.objectId.slice(0, 8)}` : "";
      return `NFT ${objectId} transferred from ${fromName} to ${toName}`;
    }
    case "OBJECT_CREATED": {
      const fromName = resolveDisplayName(action.from);
      const count = action.amount || "1";
      return `${count} new object${count !== "1" ? "s were" : " was"} created by ${fromName}`;
    }
    case "MOVE_CALL": {
      const fromName = resolveDisplayName(action.from);
      const callInfo = action.coinType || "unknown function";
      // Format: package::module::function
      const parts = callInfo.split("::");
      if (parts.length >= 3) {
        const [packageId, module, functionName] = parts;
        const packageShort = packageId.length > 20 
          ? `${packageId.slice(0, 10)}...${packageId.slice(-6)}`
          : packageId;
        return `${fromName} called ${module}::${functionName} in package ${packageShort}`;
      }
      return `${fromName} executed Move call: ${callInfo}`;
    }
    case "CONTRACT_CALL": {
      const fromName = resolveDisplayName(action.from);
      return `${fromName} executed a contract call`;
    }
    case "STAKING": {
      const fromName = resolveDisplayName(action.from);
      return `${fromName} staked SUI`;
    }
    case "SWAP": {
      const fromName = resolveDisplayName(action.from);
      return `${fromName} executed a swap`;
    }
    default:
      return "Unrecognized action";
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const resolvedParams = await params;
  const { txHash: rawTxHash } = resolvedParams;

  // Extract and validate transaction digest
  // Sui digests can be in base58 format (e.g., "GX67hXSgrpKY3u9YoTkRbMG6Zvov4zJzeWdqAhPGnEbo")
  // or hex format (64 hex characters)
  let txDigest: string | null = null;

  if (typeof rawTxHash === "string") {
    const trimmed = rawTxHash.trim();
    
    // Check for hex format (64 hex characters, with or without 0x prefix)
    const hexMatch = trimmed.match(/(?:0x)?([0-9a-fA-F]{64})/i);
    if (hexMatch) {
      txDigest = hexMatch[1];
    }
    // Check for base58 format (Sui's native format)
    // Base58: 32-44 characters using 1-9A-HJ-NP-Za-km-z (no 0, O, I, l)
    else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
      txDigest = trimmed;
    }
  }

  if (!txDigest) {
    return NextResponse.json(
      {
        error: "Invalid transaction digest",
        details: "Transaction digest must be a 64-character hex string or base58-encoded string (32-44 characters).",
        received: rawTxHash,
      },
      { status: 400 },
    );
  }

  try {
    // Default to Sui mainnet
    // Use custom RPC if provided, otherwise use mainnet public RPC
    const client = getSuiClient("mainnet");
    let txBlock = null;
    let lastError: Error | null = null;

    try {
      txBlock = await client.getTransactionBlock({
        digest: txDigest,
        options: {
          showInput: true,
          showEffects: true,
          showEvents: true,
          showObjectChanges: true,
          showBalanceChanges: true,
        },
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error("Error fetching transaction from Sui mainnet:", error);
    }

    if (!txBlock) {
      return NextResponse.json(
        {
          error: "Transaction not found on Sui Mainnet",
          details:
            lastError?.message ||
            "The transaction could not be found on Sui Mainnet. Please verify the transaction digest is correct and that it exists on mainnet.",
          suggestion:
            "This application is configured for Sui Mainnet. Make sure the transaction digest is from a mainnet transaction.",
        },
        { status: 404 },
      );
    }

    // Parse transaction data
    const status =
      txBlock.effects?.status?.status === "success"
        ? "success"
        : txBlock.effects?.status?.status === "failure"
          ? "reverted"
          : "pending_or_unknown";

    // Sui transaction structure might be different - try multiple paths
    const txData = txBlock.transaction?.data as any;
    const sender = 
      txData?.transaction?.sender ||
      txData?.sender ||
      (txBlock as any).sender ||
      "unknown";
    
    // Extract transaction type
    const transactionKind = 
      txData?.transaction?.kind ||
      (txBlock as any).transaction?.kind ||
      "Unknown";
    
    // Extract checkpoint sequence number
    // Checkpoint might be in different locations depending on SDK version
    const checkpointSeq = 
      (txBlock as any).checkpoint ||
      (txBlock as any).checkpointSeq ||
      (txBlock as any).checkpointSequenceNumber ||
      (txBlock.effects as any)?.checkpoint ||
      null;
    
    // Extract timestamp (Sui uses timestampMs)
    // Timestamp might need to be fetched from checkpoint or transaction
    const timestampMs = 
      (txBlock as any).timestampMs ||
      (txBlock as any).timestamp ||
      (txBlock.effects as any)?.timestampMs ||
      null;
    
    // Format timestamp
    let formattedTimestamp: string | null = null;
    if (timestampMs) {
      try {
        const date = new Date(Number(timestampMs));
        formattedTimestamp = date.toISOString();
      } catch {
        formattedTimestamp = timestampMs.toString();
      }
    }
      
    const gasUsed = (txBlock.effects?.gasUsed || {}) as {
      computationCost?: string;
      storageCost?: string;
      storageRebate?: string;
    };
    const computationCost = hexToDecimalString(gasUsed.computationCost);
    const storageCost = hexToDecimalString(gasUsed.storageCost);
    const storageRebate = hexToDecimalString(gasUsed.storageRebate);
    const totalGasCost =
      BigInt(computationCost) +
      BigInt(storageCost) -
      BigInt(storageRebate);

    // Parse coin transfers
    const coinTransfers = parseCoinTransfers(txBlock.events);

    // Classify actions
    const actions = classifyActions(txBlock as SuiTransactionBlock, coinTransfers);
    
    // Count object creation
    const objectCreatedCount = actions.filter(a => a.type === "OBJECT_CREATED")
      .reduce((sum, a) => sum + parseInt(a.amount || "0", 10), 0);

    const explanation = {
      txDigest: txBlock.digest,
      status,
      transactionType: transactionKind,
      checkpointSeq: checkpointSeq?.toString() || null,
      timestamp: formattedTimestamp,
      timestampMs: timestampMs?.toString() || null,
      summary: {
        from: sender,
        objectsCreated: objectCreatedCount,
        gasUsed: {
          computationCost,
          storageCost,
          storageRebate,
          total: totalGasCost.toString(10),
        },
      },
      transfers: {
        coins: coinTransfers,
      },
      actions,
      actionExplanations: actions.map(explain),
      raw: {
        transaction: txBlock,
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
