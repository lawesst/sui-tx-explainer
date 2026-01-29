"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ---- Types that mirror the API response (simplified) ----

type Summary = {
  from: string;
  objectsCreated?: number;
  gasUsed: {
    computationCost: string;
    storageCost: string;
    storageRebate: string;
    total: string;
  };
};

type Action = {
  type: string;
  description: string;
  from?: string;
  to?: string | null;
  coinType?: string;
  amount?: string;
  objectId?: string;
  tokenContract?: string;
};

type ExplanationResponse = {
  txDigest: string;
  status: string;
  transactionType?: string;
  checkpointSeq?: string | null;
  timestamp?: string | null;
  timestampMs?: string | null;
  summary: Summary;
  transfers: {
    coins: Array<{
      coinType: string;
      from: string;
      to: string;
      amount: string;
    }>;
  };
  actions: Action[];
  actionExplanations: string[];
};

// ---- Utility helpers (client-side) ----

function shortenAddress(addr?: string | null): string {
  if (!addr) return "unknown";
  const a = addr.toLowerCase();
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function formatNumber(num: string | number): string {
  const str = typeof num === "string" ? num : num.toString();
  if (str.includes(".")) {
    const [whole, decimal] = str.split(".");
    return `${formatInteger(whole)}.${decimal}`;
  }
  return formatInteger(str);
}

function formatInteger(num: string): string {
  return num.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMistToSui(mist: string | undefined): string {
  if (!mist) return "0 SUI";
  try {
    const raw = BigInt(mist);
    const base = BigInt("1000000000"); // SUI has 9 decimals
    const whole = raw / base;
    const frac = raw % base;
    
    if (frac === BigInt(0)) {
      return `${formatNumber(whole.toString(10))} SUI`;
    }
    
    const fracStr = frac
      .toString(10)
      .padStart(9, "0")
      .replace(/0+$/, "");
    
    const wholeFormatted = formatNumber(whole.toString(10));
    return `${wholeFormatted}.${fracStr} SUI`;
  } catch {
    return `${formatNumber(mist)} mist`;
  }
}

function formatLargeNumber(num: string): string {
  try {
    const n = BigInt(num);
    if (n === BigInt(0)) return "0";
    
    // Format with commas
    return formatNumber(n.toString(10));
  } catch {
    return num;
  }
}

function formatCoinAmount(
  coinType: string | undefined,
  rawAmount: string | undefined,
): { amount: string; symbol: string } {
  if (!rawAmount) {
    return { amount: "0", symbol: "coins" };
  }

  // Default to SUI decimals (9)
  const decimals = 9;
  let symbol = "SUI";

  // Check for known coin types
  if (coinType?.includes("sui::SUI")) {
    symbol = "SUI";
  } else if (coinType?.includes("usdc")) {
    symbol = "USDC";
  } else if (coinType?.includes("usdt")) {
    symbol = "USDT";
  } else if (coinType) {
    // Extract symbol from coin type if possible
    const parts = coinType.split("::");
    if (parts.length >= 2) {
      symbol = parts[parts.length - 1] || "coins";
    }
  }

  try {
    const raw = BigInt(rawAmount);
    const base = BigInt("1" + "0".repeat(decimals));
    const whole = raw / base;
    const frac = raw % base;

    if (frac === BigInt(0)) {
      return { amount: formatNumber(whole.toString(10)), symbol };
    }

    const fracStr = frac.toString(10).padStart(decimals, "0").replace(/0+$/, "");
    return { amount: `${formatNumber(whole.toString(10))}.${fracStr}`, symbol };
  } catch {
    return { amount: formatNumber(rawAmount), symbol };
  }
}

function extractTxDigest(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  
  // Sui transaction digests can be in two formats:
  // 1. Base58 encoded (e.g., "GX67hXSgrpKY3u9YoTkRbMG6Zvov4zJzeWdqAhPGnEbo")
  // 2. Hex format: 64 hex characters (with or without 0x prefix)
  
  const trimmed = input.trim();
  
  // First, try to find a 64-character hex string (with optional 0x prefix)
  const hexMatch = trimmed.match(/(?:0x)?([0-9a-fA-F]{64})/i);
  if (hexMatch) {
    return hexMatch[1];
  }
  
  // Try to extract hex from URL paths
  const urlHexMatch = trimmed.match(/[\/=]([0-9a-fA-F]{64})/i);
  if (urlHexMatch) {
    return urlHexMatch[1];
  }
  
  // Check for base58 encoded digest (Sui format)
  // Base58 uses: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz (no 0, O, I, l)
  // Sui base58 digests are typically 32-44 characters
  const base58Pattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (base58Pattern.test(trimmed)) {
    return trimmed;
  }
  
  // Try to extract base58 from URL paths
  const urlBase58Match = trimmed.match(/[\/=]([1-9A-HJ-NP-Za-km-z]{32,44})/);
  if (urlBase58Match) {
    return urlBase58Match[1];
  }
  
  // If input is exactly 64 hex chars (no 0x), return it
  if (/^[0-9a-fA-F]{64}$/i.test(trimmed)) {
    return trimmed;
  }
  
  // If input is 66 chars starting with 0x, return the hex part
  if (/^0x[0-9a-fA-F]{64}$/i.test(trimmed)) {
    return trimmed.slice(2);
  }
  
  return null;
}

// Token icon helper
function getTokenIcon(actionType?: string, tokenContract?: string): string {
  if (actionType === "ERC721_TRANSFER") return "🖼️";
  if (actionType === "ERC1155_TRANSFER") return "🖼️";
  if (actionType === "ERC20_TRANSFER") return "🪙";
  if (actionType === "CONTRACT_CALL") return "⚙️";
  return "📋"; // Default icon
}

// Copyable Address Component
type CopyableAddressProps = {
  address: string | null | undefined;
  variant?: "from" | "to" | "default";
  className?: string;
};

function CopyableAddress({
  address,
  variant = "default",
  className = "",
}: CopyableAddressProps) {
  const [copied, setCopied] = useState(false);

  if (!address) {
    return <span className={className}>unknown</span>;
  }

  const displayAddress = shortenAddress(address);

  // Color variants
  const colorClasses = {
    from: "text-blue-600 dark:text-blue-400 font-medium",
    to: "text-purple-600 dark:text-purple-400 font-medium",
    default: "text-indigo-600 dark:text-indigo-400 font-medium",
  };

  const handleCopy = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`group inline-flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-900/50 px-2 py-0.5 font-mono text-[10px] transition-all hover:border-indigo-500/50 hover:bg-indigo-500/10 sm:gap-2 sm:px-2.5 sm:py-1 sm:text-sm ${colorClasses[variant]} ${className}`}
      title={`Click to copy: ${address}`}
    >
      <span className="truncate max-w-[100px] sm:max-w-none">{displayAddress}</span>
      {copied ? (
        <span className="text-[10px] text-emerald-400 shrink-0 sm:text-xs">✓</span>
      ) : (
        <span className="text-[10px] text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 shrink-0 sm:text-xs">📋</span>
      )}
    </button>
  );
}

// ---- Components ----

type TxInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (txHashOrUrl: string) => void;
  loading: boolean;
};

function TxInput({ value, onChange, onSubmit, loading }: TxInputProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(value);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Transaction Input
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
      </div>
      <form
        onSubmit={handleSubmit}
        className="group relative flex flex-col gap-3 rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-800/40 to-slate-900/40 p-4 shadow-xl backdrop-blur-sm transition-all duration-300 hover:border-indigo-500/30 hover:shadow-2xl sm:gap-4 sm:p-6"
      >
        <label className="text-xs font-medium text-slate-300 sm:text-sm">
          Paste a Sui transaction digest or Sui Explorer link
        </label>
        <div className="relative">
          <input
            className="w-full rounded-xl border border-slate-700/50 bg-slate-900/50 px-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 shadow-inner outline-none ring-0 transition-all duration-200 focus:border-indigo-500/50 focus:bg-slate-900/70 focus:ring-2 focus:ring-indigo-500/20 sm:px-4 sm:py-3.5 sm:text-sm"
            placeholder="GX67hXSgrpKY3u9YoTkRbMG6Zvov4zJzeWdqAhPGnEbo"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={loading}
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent sm:h-5 sm:w-5" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="group/btn relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-all duration-200 hover:from-indigo-500 hover:to-purple-500 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-lg sm:w-auto sm:px-6 sm:py-3 sm:text-sm"
          >
            <span className="relative z-10 flex items-center gap-2">
              {loading ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent sm:h-4 sm:w-4" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <span className="text-sm sm:text-base">🔍</span>
                  <span className="hidden sm:inline">Explain Transaction</span>
                  <span className="sm:hidden">Explain</span>
                </>
              )}
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-400 to-purple-400 opacity-0 transition-opacity duration-200 group-hover/btn:opacity-100" />
          </button>
          <p className="hidden text-xs text-slate-500 sm:block">
            Secure • Read-only • No keys required
          </p>
          <p className="text-center text-[10px] text-slate-500 sm:hidden">
            Secure & Read-only
          </p>
        </div>
      </form>
    </section>
  );
}

type ExplanationSummaryProps = {
  data: ExplanationResponse | null;
};

function ExplanationSummary({ data }: ExplanationSummaryProps) {
  if (!data) return null;

  const { txDigest, status, summary } = data;

  const [txDigestCopied, setTxDigestCopied] = useState(false);

  const handleCopyTxDigest = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(txDigest);
      setTxDigestCopied(true);
      setTimeout(() => setTxDigestCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Summary
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
      </div>
      <div className="space-y-3 rounded-xl border border-slate-800/50 bg-gradient-to-br from-slate-800/40 to-slate-900/40 p-4 shadow-xl backdrop-blur-sm sm:space-y-4 sm:rounded-2xl sm:p-6">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold shadow-lg sm:gap-2 sm:px-3 sm:py-1.5 sm:text-xs ${
              status === "success"
                ? "bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-300 border border-emerald-500/30"
                : status === "reverted"
                  ? "bg-gradient-to-r from-red-500/20 to-rose-500/20 text-red-300 border border-red-500/30"
                  : "bg-gradient-to-r from-slate-500/20 to-slate-600/20 text-slate-300 border border-slate-500/30"
            }`}
          >
            <span className={`h-1 w-1 rounded-full sm:h-1.5 sm:w-1.5 ${
              status === "success" ? "bg-emerald-400" : status === "reverted" ? "bg-red-400" : "bg-slate-400"
            }`} />
            {status.toUpperCase()}
          </span>
          <button
            onClick={handleCopyTxDigest}
            className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-900/50 px-2 py-1 font-mono text-[10px] text-slate-300 transition-all hover:border-indigo-500/50 hover:bg-indigo-500/10 sm:gap-2 sm:px-3 sm:py-1.5 sm:text-xs"
            title={`Click to copy: ${txDigest}`}
          >
            <code className="truncate max-w-[80px] sm:max-w-none">{shortenAddress(txDigest)}</code>
            {txDigestCopied ? (
              <span className="text-emerald-400 text-[10px] sm:text-xs">✓</span>
            ) : (
              <span className="text-slate-500 text-[10px] group-hover:text-indigo-400 sm:text-xs">📋</span>
            )}
          </button>
        </div>
        <div className="rounded-lg bg-slate-900/30 p-3 sm:p-4">
          <p className="text-xs leading-relaxed text-slate-300 sm:text-sm">
            Transaction executed by{" "}
            <CopyableAddress address={summary.from} variant="from" />.
            {summary.objectsCreated !== undefined && summary.objectsCreated > 0 && (
              <span className="ml-1.5 mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/30 sm:ml-2 sm:mt-0 sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-xs">
                <span>✨</span>
                <span>{summary.objectsCreated} object{summary.objectsCreated !== 1 ? "s" : ""} created</span>
              </span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

type TransactionFlowProps = {
  data: ExplanationResponse | null;
};

function TransactionFlow({ data }: TransactionFlowProps) {
  if (!data || !data.actions || data.actions.length === 0) return null;

  // Extract unique transfer flows (from → to)
  const flows: Array<{ from: string; to: string; type: string; label: string }> = [];
  
  for (const action of data.actions) {
    if (action.from && action.to && (action.type === "COIN_TRANSFER" || action.type === "NFT_TRANSFER")) {
      // Check if this flow already exists
      const exists = flows.some(
        f => f.from === action.from && f.to === action.to && f.type === action.type
      );
      
      if (!exists) {
        let label = "";
        if (action.type === "COIN_TRANSFER") {
          const { amount, symbol } = formatCoinAmount(action.coinType, action.amount);
          label = `${amount} ${symbol}`;
        } else if (action.type === "NFT_TRANSFER") {
          label = action.objectId ? `NFT #${action.objectId.slice(0, 8)}` : "NFT";
        }
        
        flows.push({
          from: action.from,
          to: action.to,
          type: action.type,
          label,
        });
      }
    }
  }

  if (flows.length === 0) return null;

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Transaction Flow
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
      </div>
      <div className="space-y-4 rounded-xl border border-slate-800/50 bg-gradient-to-br from-slate-800/40 to-slate-900/40 p-4 shadow-xl backdrop-blur-sm sm:rounded-2xl sm:p-6">
        {flows.map((flow, idx) => (
          <div key={idx} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            {/* Mobile: Vertical layout */}
            <div className="flex flex-col gap-3 sm:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-indigo-500/50 bg-gradient-to-br from-indigo-500/20 to-purple-500/20">
                  <span className="text-xs">👤</span>
                </div>
                <CopyableAddress address={flow.from} variant="from" className="text-xs" />
              </div>
              <div className="flex items-center justify-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
                <span className="text-base">↓</span>
                <span className="text-xs font-medium text-indigo-300">{flow.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-purple-500/50 bg-gradient-to-br from-purple-500/20 to-pink-500/20">
                  <span className="text-xs">👤</span>
                </div>
                <CopyableAddress address={flow.to} variant="to" className="text-xs" />
              </div>
            </div>
            
            {/* Desktop: Horizontal layout */}
            <div className="hidden flex-1 items-center gap-3 sm:flex">
              <div className="flex flex-col items-center gap-1">
                <div className="h-10 w-10 rounded-full border-2 border-indigo-500/50 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                  <span className="text-xs">👤</span>
                </div>
                <CopyableAddress address={flow.from} variant="from" className="text-xs" />
              </div>
              
              <div className="flex-1 flex items-center gap-2">
                <div className="h-px flex-1 bg-gradient-to-r from-indigo-500/50 to-purple-500/50" />
                <div className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5">
                  <span className="text-lg">→</span>
                  <span className="text-xs font-medium text-indigo-300">{flow.label}</span>
                </div>
                <div className="h-px flex-1 bg-gradient-to-r from-purple-500/50 to-indigo-500/50" />
              </div>
              
              <div className="flex flex-col items-center gap-1">
                <div className="h-10 w-10 rounded-full border-2 border-purple-500/50 bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                  <span className="text-xs">👤</span>
                </div>
                <CopyableAddress address={flow.to} variant="to" className="text-xs" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type TransactionMetadataProps = {
  data: ExplanationResponse | null;
};

function TransactionMetadata({ data }: TransactionMetadataProps) {
  if (!data) return null;

  const formatDate = (timestamp: string | null | undefined): string => {
    if (!timestamp) return "N/A";
    try {
      const date = new Date(timestamp);
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Transaction Details
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
      </div>
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800/50 bg-gradient-to-br from-slate-800/40 to-slate-900/40 p-4 shadow-xl backdrop-blur-sm sm:grid-cols-2 sm:gap-4 sm:rounded-2xl sm:p-6">
        <div className="group rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 transition-all hover:border-indigo-500/30 hover:bg-slate-900/50 sm:rounded-xl sm:p-4">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:mb-2 sm:text-xs">
            Transaction Type
          </p>
          <p className="text-xs font-semibold text-slate-200 break-words sm:text-sm">
            {data.transactionType || "Unknown"}
          </p>
        </div>
        <div className="group rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 transition-all hover:border-indigo-500/30 hover:bg-slate-900/50 sm:rounded-xl sm:p-4">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:mb-2 sm:text-xs">Digest</p>
          <p className="font-mono text-[10px] text-slate-300 break-all sm:text-xs">
            {shortenAddress(data.txDigest)}
          </p>
        </div>
        {data.checkpointSeq && (
          <div className="group rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 transition-all hover:border-indigo-500/30 hover:bg-slate-900/50 sm:rounded-xl sm:p-4">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:mb-2 sm:text-xs">
              Checkpoint Seq. Number
            </p>
            <p className="text-xs font-semibold text-slate-200 break-words sm:text-sm">
              {formatLargeNumber(data.checkpointSeq)}
            </p>
          </div>
        )}
        {data.timestamp && (
          <div className="group rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 transition-all hover:border-indigo-500/30 hover:bg-slate-900/50 sm:rounded-xl sm:p-4">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:mb-2 sm:text-xs">Timestamp</p>
            <p className="text-xs font-semibold text-slate-200 break-words sm:text-sm">
              {formatDate(data.timestamp)}
            </p>
          </div>
        )}
        <div className="group rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 transition-all hover:border-indigo-500/30 hover:bg-slate-900/50 sm:col-span-2 sm:rounded-xl sm:p-4">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:mb-2 sm:text-xs">Sender</p>
          <div className="mt-1">
            <CopyableAddress address={data.summary.from} variant="from" />
          </div>
        </div>
      </div>
    </section>
  );
}

type ActionListProps = {
  explanations: string[] | null;
  actions: Action[] | null;
};

function ActionList({ explanations, actions }: ActionListProps) {
  if (!explanations || explanations.length === 0) return null;

  // Helper to render explanation with copyable addresses
  const renderExplanation = (line: string, action: Action | undefined) => {
    if (!action) return <span>{line}</span>;

    // Build a map of shortened addresses to full addresses
    const addressMap = new Map<string, { address: string; variant: "from" | "to" }>();
    
    if (action.from) {
      addressMap.set(shortenAddress(action.from), {
        address: action.from,
        variant: "from",
      });
    }
    if (action.to) {
      addressMap.set(shortenAddress(action.to), {
        address: action.to,
        variant: "to",
      });
    }

    // Try to find and replace addresses
    const addressPattern = /0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}/g;
    const parts: (string | React.ReactElement)[] = [];
    let lastIndex = 0;
    let match;
    let matchIndex = 0;

    while ((match = addressPattern.exec(line)) !== null) {
      // Add text before the address
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }

      const shortenedAddr = match[0];
      const addressInfo = addressMap.get(shortenedAddr);

      if (addressInfo) {
        // Add the copyable address component
        parts.push(
          <CopyableAddress
            key={`addr-${matchIndex}`}
            address={addressInfo.address}
            variant={addressInfo.variant}
          />,
        );
      } else {
        // Fallback: just show the text
        parts.push(shortenedAddr);
      }

      lastIndex = match.index + match[0].length;
      matchIndex++;
    }

    // Add remaining text
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return parts.length > 0 ? <>{parts}</> : <span>{line}</span>;
  };

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Actions
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
      </div>
      <ol className="space-y-2 rounded-xl border border-slate-800/50 bg-gradient-to-br from-slate-800/40 to-slate-900/40 p-4 shadow-xl backdrop-blur-sm sm:space-y-3 sm:rounded-2xl sm:p-6">
        {explanations.map((line, idx) => {
          const action = actions?.[idx];
          const icon = getTokenIcon(action?.type, action?.tokenContract);

          return (
            <li
              key={idx}
              className="group flex items-start gap-2.5 rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 text-xs text-slate-300 transition-all hover:border-indigo-500/30 hover:bg-slate-900/50 sm:gap-4 sm:rounded-xl sm:p-4 sm:text-sm"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-[10px] font-bold text-indigo-300 shadow-lg sm:h-7 sm:w-7 sm:rounded-lg sm:text-xs">
                {idx + 1}
              </div>
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-sm sm:mt-0 sm:h-6 sm:w-6 sm:text-lg">
                {icon}
              </div>
              <span className="flex-1 break-words leading-relaxed">{renderExplanation(line, action)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type GasBreakdownProps = {
  summary: Summary | null;
};

function GasBreakdown({ summary }: GasBreakdownProps) {
  if (!summary) return null;

  const totalSui = formatMistToSui(summary.gasUsed.total);
  const computationCost = formatMistToSui(summary.gasUsed.computationCost);
  const storageCost = formatMistToSui(summary.gasUsed.storageCost);
  const storageRebate = formatMistToSui(summary.gasUsed.storageRebate);

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Gas Breakdown
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
      </div>
      <div className="space-y-3 rounded-xl border border-slate-800/50 bg-gradient-to-br from-slate-800/40 to-slate-900/40 p-4 shadow-xl backdrop-blur-sm sm:space-y-4 sm:rounded-2xl sm:p-6">
        <div className="flex items-center justify-between rounded-lg border border-indigo-500/20 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 p-3 sm:rounded-xl sm:p-4">
          <span className="text-xs font-medium text-slate-300 sm:text-sm">
            Total Gas Cost
          </span>
          <span className="text-base font-bold text-indigo-300 sm:text-lg">
            {totalSui}
          </span>
        </div>
        
        <div className="grid grid-cols-1 gap-3 border-t border-slate-700/50 pt-3 sm:grid-cols-3 sm:gap-4 sm:pt-4">
          <div className="group rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 text-center transition-all hover:border-indigo-500/30 hover:bg-slate-900/50 sm:rounded-xl sm:p-4">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:mb-2 sm:text-xs">
              Computation
            </p>
            <p className="text-xs font-semibold text-slate-200 sm:text-sm">
              {computationCost}
            </p>
          </div>
          <div className="group rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 text-center transition-all hover:border-indigo-500/30 hover:bg-slate-900/50 sm:rounded-xl sm:p-4">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:mb-2 sm:text-xs">
              Storage
            </p>
            <p className="text-xs font-semibold text-slate-200 sm:text-sm">
              {storageCost}
            </p>
          </div>
          <div className="group rounded-lg border border-slate-700/30 bg-slate-900/30 p-3 text-center transition-all hover:border-indigo-500/30 hover:bg-slate-900/50 sm:rounded-xl sm:p-4">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:mb-2 sm:text-xs">
              Storage Rebate
            </p>
            <p className="text-xs font-semibold text-emerald-300 sm:text-sm">
              -{storageRebate}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Page ----

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExplanationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Load tx hash from URL on mount
  useEffect(() => {
    const txHash = searchParams.get("tx");
    if (txHash && !result) {
      setInput(txHash);
      handleExplain(txHash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExplain = useCallback(async (raw: string) => {
    setError(null);
    setResult(null);

    const digest = extractTxDigest(raw.trim());
    if (!digest) {
      setError(
        `Invalid transaction digest format. Please paste a Sui transaction digest (base58 or hex format) or a Sui Explorer link.\n\nExamples:\n- Base58: GX67hXSgrpKY3u9YoTkRbMG6Zvov4zJzeWdqAhPGnEbo\n- Hex: 0x... (64 hex chars)\n- URL: https://suiexplorer.com/txblock/...`
      );
      return;
    }

    // Update URL with shareable link
    router.push(`/?tx=${digest}`, { scroll: false });

    setLoading(true);
    try {
      const res = await fetch(`/api/explain/${digest}`, {
        method: "GET",
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json?.error ?? "Failed to explain transaction.");
        setLoading(false);
        return;
      }

      setResult(json as ExplanationResponse);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unexpected error while fetching explanation.",
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  const handleShare = useCallback(() => {
    if (!result?.txDigest || typeof window === "undefined") return;

    const url = `${window.location.origin}/?tx=${result.txDigest}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  return (
    <div className="relative flex min-h-screen items-start justify-center overflow-x-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 px-3 py-6 font-sans sm:px-4 sm:py-12">
      {/* Animated background gradients */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-indigo-500/20 via-purple-500/10 to-transparent" />
        <div className="absolute inset-x-0 top-1/4 h-96 bg-gradient-to-b from-cyan-500/10 via-blue-500/5 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.1),transparent_70%)]" />
      </div>
      
      <main className="relative z-10 flex w-full max-w-5xl flex-col gap-6 overflow-x-hidden rounded-2xl border border-slate-800/50 bg-slate-900/40 p-4 shadow-2xl backdrop-blur-2xl transition-all duration-300 hover:border-slate-700/50 sm:rounded-3xl sm:gap-8 sm:p-8 lg:p-10">
        <header className="space-y-3 sm:space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 px-3 py-1 text-xs font-medium text-indigo-200 shadow-lg backdrop-blur-sm sm:px-4 sm:py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span>Sui Mainnet</span>
          </div>
          <div className="space-y-1.5 sm:space-y-2">
            <h1 className="bg-gradient-to-r from-slate-50 via-indigo-100 to-slate-50 bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-4xl lg:text-5xl">
              Sui Transaction Explainer
            </h1>
            <p className="text-xs leading-relaxed text-slate-400 sm:text-sm sm:max-w-2xl">
              Decode Sui Mainnet transactions with human-readable explanations. 
              Understand coin transfers, object movements, and gas costs at a glance.
            </p>
          </div>
        </header>

        <TxInput
          value={input}
          onChange={setInput}
          onSubmit={handleExplain}
          loading={loading}
        />

        {error && (
          <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-red-900/20 p-4 text-xs text-red-200 shadow-lg backdrop-blur-sm sm:rounded-2xl sm:p-5 sm:text-sm">
            <div className="flex items-start gap-2 sm:gap-3">
              <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/20 sm:h-5 sm:w-5">
                <span className="text-sm text-red-400 sm:text-base">⚠</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="break-words font-medium text-red-100">{error}</p>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-3 rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/30 to-purple-950/20 p-4 shadow-xl backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:rounded-2xl sm:p-5">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 sm:h-10 sm:w-10 sm:rounded-xl">
                <span className="text-base sm:text-xl">🔗</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium text-slate-400 sm:text-xs">Share this explanation</p>
                <code className="mt-1 block truncate rounded-lg bg-slate-900/50 px-2 py-1 text-[10px] font-mono text-slate-300 sm:px-3 sm:py-1.5 sm:text-xs">
                  ?tx={result.txDigest.slice(0, 12)}...
                </code>
              </div>
            </div>
            <button
              onClick={handleShare}
              className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition-all duration-200 hover:from-indigo-500 hover:to-purple-500 hover:shadow-xl sm:w-auto sm:px-5 sm:py-2.5 sm:text-sm"
            >
              <span className="relative z-10 flex items-center gap-2">
                {copied ? (
                  <>
                    <span className="text-sm sm:text-base">✓</span>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm sm:text-base">📋</span>
                    <span>Copy Link</span>
                  </>
                )}
              </span>
            </button>
          </div>
        )}

        <ExplanationSummary data={result} />
        <TransactionFlow data={result} />
        <TransactionMetadata data={result} />
        <ActionList
          explanations={result?.actionExplanations ?? null}
          actions={result?.actions ?? null}
        />
        <GasBreakdown summary={result?.summary ?? null} />

        <footer className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-slate-800/50 pt-4 text-[10px] text-slate-500 sm:mt-8 sm:flex-row sm:gap-4 sm:pt-6 sm:text-xs">
          <span className="text-center text-xs sm:text-left sm:text-xs">
            Explain another transaction by pasting a new digest above.
          </span>
          <span className="flex items-center gap-1.5 sm:gap-2">
            <span className="relative flex h-1.5 w-1.5 sm:h-2 sm:w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex h-full w-full rounded-full bg-indigo-400" />
            </span>
            <span className="font-medium">Optimized for Sui</span>
          </span>
        </footer>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
