"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ---- Types that mirror the API response (simplified) ----

type Summary = {
  from: string;
  to: string | null;
  nativeValueWei: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  l2FeeWei?: string;
  l1FeeWei?: string;
};

type Action = {
  type: string;
  description: string;
  from?: string;
  to?: string | null;
  tokenContract?: string;
  tokenId?: string;
  amount?: string;
};

type ExplanationResponse = {
  txHash: string;
  status: string;
  summary: Summary;
  transfers: {
    native: {
      from: string;
      to: string | null;
      valueWei: string;
    };
    tokens: unknown[];  };
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

function formatWeiToEth(wei: string | undefined): string {
  if (!wei) return "0 ETH";
  try {
    const raw = BigInt(wei);
    const base = BigInt("1000000000000000000");
    const whole = raw / base;
    const frac = raw % base;
    
    if (frac === BigInt(0)) {
      return `${formatNumber(whole.toString(10))} ETH`;
    }
    
    const fracStr = frac
      .toString(10)
      .padStart(18, "0")
      .replace(/0+$/, "");
    
    const wholeFormatted = formatNumber(whole.toString(10));
    return `${wholeFormatted}.${fracStr} ETH`;
  } catch {
    return `${formatNumber(wei)} wei`;
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

function extractTxHash(input: string): string | null {
  const match = input.match(/0x[0-9a-fA-F]{64}/);
  return match ? match[0] : null;
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
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${colorClasses[variant]} ${className}`}
      title={`Click to copy: ${address}`}
    >
      <span className="font-mono text-sm">{displayAddress}</span>
      {copied ? (
        <span className="text-xs">✓</span>
      ) : (
        <span className="text-xs opacity-60">📋</span>
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
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Transaction Input
      </h2>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <label className="text-sm text-zinc-600 dark:text-zinc-400">
          Paste an Arbitrum transaction hash or Arbiscan link.
        </label>
        <input
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-50 dark:focus:ring-zinc-50/10"
          placeholder="0x... or https://arbiscan.io/tx/0x..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {loading ? "Explaining..." : "Explain transaction"}
          </button>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            No private keys required. Read-only RPC on Arbitrum.
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

  const { txHash, status, summary } = data;
  const nativeValue = formatWeiToEth(summary.nativeValueWei);
  const hasNativeValue = (() => {
    try {
      return BigInt(summary.nativeValueWei) > BigInt("0");
    } catch {
      return false;
    }
  })();

  const [txHashCopied, setTxHashCopied] = useState(false);

  const handleCopyTxHash = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(txHash);
      setTxHashCopied(true);
      setTimeout(() => setTxHashCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Explanation Summary
      </h2>
      <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              status === "success"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : status === "reverted"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
            }`}
          >
            {status}
          </span>
          <button
            onClick={handleCopyTxHash}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            title={`Click to copy: ${txHash}`}
          >
            <code className="truncate">{shortenAddress(txHash)}</code>
            {txHashCopied ? (
              <span className="text-xs">✓</span>
            ) : (
              <span className="text-xs opacity-60">📋</span>
            )}
          </button>
        </div>
        <p className="text-zinc-700 dark:text-zinc-300">
          <CopyableAddress address={summary.from} variant="from" />{" "}
          {hasNativeValue ? `sent ${nativeValue} to` : "interacted with"}{" "}
          <CopyableAddress address={summary.to} variant="to" />.
        </p>
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
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Actions
      </h2>
      <ol className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        {explanations.map((line, idx) => {
          const action = actions?.[idx];
          const icon = getTokenIcon(action?.type, action?.tokenContract);

          return (
            <li
              key={idx}
              className="flex items-start gap-3 text-zinc-700 dark:text-zinc-300"
            >
              <span className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-zinc-900 text-center text-xs font-medium text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
                {idx + 1}
              </span>
              <span className="mr-2 text-base">{icon}</span>
              <span className="flex-1">{renderExplanation(line, action)}</span>
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

  const totalEth = formatWeiToEth(summary.totalFeeWei);
  const gasUsedFormatted = formatLargeNumber(summary.gasUsed);
  const gasPriceFormatted = formatLargeNumber(summary.effectiveGasPriceWei);
  
  const l2FeeEth = summary.l2FeeWei ? formatWeiToEth(summary.l2FeeWei) : null;
  const l1FeeEth = summary.l1FeeWei ? formatWeiToEth(summary.l1FeeWei) : null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Gas Breakdown
      </h2>
      <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">
            Total gas cost (L2 + L1 included)
          </span>
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">
            {totalEth}
          </span>
        </div>
        
        {(l2FeeEth || l1FeeEth) && (
          <div className="grid grid-cols-2 gap-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            {l2FeeEth && (
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  L2 execution fee
                </p>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {l2FeeEth}
                </p>
              </div>
            )}
            {l1FeeEth && (
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  L1 calldata fee
                </p>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {l1FeeEth}
                </p>
              </div>
            )}
          </div>
        )}
        
        <div className="grid grid-cols-2 gap-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Gas used</p>
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              {gasUsedFormatted}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Gas price
            </p>
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              {gasPriceFormatted} wei
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Page ----

export default function Home() {
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

    const hash = extractTxHash(raw.trim());
    if (!hash) {
      setError("Please paste a valid Arbitrum transaction hash or link containing one.");
      return;
    }

    // Update URL with shareable link
    router.push(`/?tx=${hash}`, { scroll: false });

    setLoading(true);
    try {
      const res = await fetch(`/api/explain/${hash}`, {
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
    if (!result?.txHash || typeof window === "undefined") return;

    const url = `${window.location.origin}/?tx=${result.txHash}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  return (
    <div className="relative flex min-h-screen items-start justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-10 font-sans">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-64 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.45),_transparent_60%)]" />
      <main className="relative z-10 flex w-full max-w-4xl flex-col gap-8 rounded-3xl border border-slate-800 bg-slate-950/80 p-8 shadow-[0_18px_45px_rgba(0,0,0,0.65)] backdrop-blur-xl">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/40 bg-slate-900/70 px-3 py-1 text-xs font-medium text-sky-100 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>Live on Arbitrum Sepolia</span>
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
              Arbitrum Transaction Explainer
            </h1>
            <p className="max-w-2xl text-sm text-slate-300">
              Paste a transaction hash and get a human-readable explainer of what
              happened on-chain: contracts called, tokens moved, and gas paid
              across L2 + L1.
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
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-3 rounded-xl border border-sky-500/30 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-300">
                Share this explanation:
              </span>
              <code className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-100">
                ?tx={result.txHash.slice(0, 10)}...
              </code>
            </div>
            <button
              onClick={handleShare}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 shadow-sm transition hover:bg-sky-400"
            >
              {copied ? (
                <>
                  <span>✓</span>
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <span>🔗</span>
                  <span>Copy link</span>
                </>
              )}
            </button>
          </div>
        )}

        <ExplanationSummary data={result} />
        <ActionList
          explanations={result?.actionExplanations ?? null}
          actions={result?.actions ?? null}
        />
        <GasBreakdown summary={result?.summary ?? null} />

        <footer className="mt-2 flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-400">
          <span>Explain another transaction by pasting a new hash above.</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            <span>Optimized for Arbitrum demos.</span>
          </span>
        </footer>
      </main>
    </div>
  );
}
