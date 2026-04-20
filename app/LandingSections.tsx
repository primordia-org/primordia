// components/LandingSections.tsx
// Server components for each section of the landing page.
// These are server components — they stream their HTML directly and appear in
// the DOM with data-component attributes added by swc-plugin-component-annotate
// at build time. The Pick tool reads those attributes for component names.
// The parent server component (app/page.tsx) handles headers() / curlCmd and
// passes it down as a prop.

import Link from "next/link";
import { MessageSquare, RefreshCw, GitBranch, ChevronDown } from "lucide-react";
import CopyButton from "./CopyButton";

// ── Feature card data ────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <MessageSquare size={28} strokeWidth={1.5} aria-hidden="true" />,
    accent: "text-blue-400",
    ring: "ring-blue-500/20",
    bg: "bg-blue-500/5",
    title: "AI Chat",
    description:
      "Talk to Claude — Anthropic's latest model — directly in your browser. Ask questions, explore ideas, or just have a conversation.",
  },
  {
    icon: <RefreshCw size={28} strokeWidth={1.5} aria-hidden="true" />,
    accent: "text-violet-400",
    ring: "ring-violet-500/20",
    bg: "bg-violet-500/5",
    title: "Self-Evolving",
    description:
      "Don't like something? Describe the change you want in plain English. Claude Code rewrites the app and spins up a live preview — no coding required.",
  },
  {
    icon: <GitBranch size={28} strokeWidth={1.5} aria-hidden="true" />,
    accent: "text-fuchsia-400",
    ring: "ring-fuchsia-500/20",
    bg: "bg-fuchsia-500/5",
    title: "Open Source",
    description:
      "Fork the repo, deploy to exe.dev in minutes, and own your instance entirely. Every change is tracked in git — full history, full control.",
  },
];

// ── How-it-works steps ───────────────────────────────────────────────────────

const STEPS = [
  { n: "01", label: "Chat", detail: "Ask Primordia anything using the built-in AI chat." },
  { n: "02", label: "Propose", detail: "See something you'd like to change? Open the menu and propose it." },
  { n: "03", label: "Review", detail: "Claude Code writes the code and spins up a live preview — inspect it in your browser." },
  { n: "04", label: "Accept", detail: "Accept the change, and your app updates itself — instantly." },
];

// ── Sections ─────────────────────────────────────────────────────────────────

export function HeroSection({ curlCmd }: { curlCmd: string }) {
  return (
    <section className="relative flex flex-col items-center justify-center min-h-dvh px-6 text-center overflow-hidden">
      {/* Animated gradient blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* Blob A — blue/indigo, top-left */}
        <div className="animate-blob-a absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full bg-blue-600/15 blur-3xl" />
        {/* Blob B — violet/purple, top-right */}
        <div className="animate-blob-b absolute -top-16 -right-40 w-[500px] h-[500px] rounded-full bg-violet-600/15 blur-3xl" />
        {/* Blob C — fuchsia/pink, bottom-center */}
        <div className="animate-blob-c absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-fuchsia-700/10 blur-3xl" />
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {/* Headline */}
      <h1 className="animate-fade-up-2 relative font-mono font-black text-6xl sm:text-7xl md:text-8xl leading-none tracking-tighter mb-6">
        <span className="text-shimmer">PRIMORDIA</span>
      </h1>

      {/* Sub-headline */}
      <p className="animate-fade-up-3 relative max-w-xl text-lg sm:text-xl text-gray-400 leading-relaxed mb-10">
        The web application that writes itself.
      </p>

      {/* Primary CTA — curl install command */}
      <div className="animate-fade-up-4 relative w-full max-w-2xl">
        <p className="text-xs font-mono text-gray-500 mb-2 text-center uppercase tracking-widest">
          Deploy your own instance
        </p>
        <div className="group relative flex items-center rounded-xl border border-white/10 bg-gray-900/80 backdrop-blur px-4 py-3 gap-3 hover:border-white/20 transition-colors">
          {/* Terminal prompt */}
          <span className="select-none text-gray-600 font-mono text-sm shrink-0">$</span>
          <code className="flex-1 font-mono text-sm text-green-400 truncate">{curlCmd}</code>
          {/* Copy button */}
          <CopyButton text={curlCmd} />
        </div>
        <p className="text-xs text-gray-600 text-center mt-2 font-mono">
          Script requires an{" "}
          <a href="https://exe.dev" data-id="landing/exedev-link" className="text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors">
            exe.dev
          </a>{" "}
          account and SSH
        </p>
      </div>

      {/* Scroll hint */}
      <div className="animate-fade-in absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-gray-600">
        <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
      </div>
    </section>
  );
}

export function FeaturesSection() {
  return (
    <section className="relative px-6 py-24 max-w-5xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="font-mono font-bold text-3xl sm:text-4xl text-white mb-4">
          What is Primordia?
        </h2>
        <p className="text-gray-400 max-w-2xl mx-auto leading-relaxed">
          It&apos;s the app that builds itself. You interact with it, you shape it —
          and it evolves to become whatever you need.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {FEATURES.map((f) => (
          <FeatureCard key={f.title} {...f} />
        ))}
      </div>
    </section>
  );
}

function FeatureCard({
  icon,
  accent,
  ring,
  bg,
  title,
  description,
}: {
  icon: React.ReactNode;
  accent: string;
  ring: string;
  bg: string;
  title: string;
  description: string;
}) {
  return (
    <div
      className={`group relative rounded-2xl p-6 border border-white/5 ${bg} ring-1 ${ring} hover:border-white/10 transition-all hover:-translate-y-1`}
    >
      <div className={`mb-4 ${accent}`}>{icon}</div>
      <h3 className="font-mono font-semibold text-lg text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}

export function HowItWorksSection() {
  return (
    <section className="relative px-6 py-24 border-t border-white/5">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="font-mono font-bold text-3xl sm:text-4xl text-white mb-4">
            How it works
          </h2>
          <p className="text-gray-400">Four steps from idea to live change.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {STEPS.map((s, i) => (
            <HowItWorksStep key={s.n} step={s} isLast={i === STEPS.length - 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksStep({
  step,
  isLast,
}: {
  step: { n: string; label: string; detail: string };
  isLast: boolean;
}) {
  return (
    <div className="relative">
      {/* Connector line (not on last item) */}
      {!isLast && (
        <div className="hidden lg:block absolute top-5 left-full w-full h-px bg-gradient-to-r from-white/10 to-transparent -translate-y-px" aria-hidden="true" />
      )}
      <div className="font-mono text-3xl font-black text-white/8 mb-3 select-none">{step.n}</div>
      <h3 className="font-mono font-semibold text-white text-lg mb-2">{step.label}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{step.detail}</p>
    </div>
  );
}

export function CTABannerSection({ curlCmd }: { curlCmd: string }) {
  return (
    <section className="relative px-6 py-24">
      <div className="relative max-w-3xl mx-auto rounded-3xl overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 via-violet-600/15 to-fuchsia-600/10" aria-hidden="true" />
        <div className="absolute inset-0 border border-white/5 rounded-3xl" aria-hidden="true" />

        <div className="relative px-8 py-16 text-center">
          <h2 className="font-mono font-black text-3xl sm:text-4xl text-white mb-4 tracking-tight">
            Ready to deploy?
          </h2>
          <p className="text-gray-400 max-w-md mx-auto mb-8 leading-relaxed">
            One command sets up a new VM in your exe.dev account and installs Primordia end-to-end.
          </p>
          <div className="flex items-center rounded-xl border border-white/10 bg-black/40 px-4 py-3 gap-3 max-w-2xl mx-auto mb-4">
            <span className="select-none text-gray-600 font-mono text-sm shrink-0">$</span>
            <code className="flex-1 font-mono text-sm text-green-400 text-left truncate">{curlCmd}</code>
            <CopyButton text={curlCmd} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-white/5 px-6 py-10">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500 font-mono">
        <span>Primordia — the self-modifying web application</span>
        <div className="flex items-center gap-6">
          <Link data-id="landing/footer-chat" href="/chat" className="hover:text-gray-300 transition-colors">Chat</Link>
          <Link data-id="landing/footer-evolve" href="/evolve" className="hover:text-gray-300 transition-colors">Evolve</Link>
          <Link data-id="landing/footer-changelog" href="/changelog" className="hover:text-gray-300 transition-colors">Changelog</Link>
          <Link data-id="landing/footer-login" href="/login" className="hover:text-gray-300 transition-colors">Login</Link>
        </div>
      </div>
    </footer>
  );
}
