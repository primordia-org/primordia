// app/under-the-hood/page.tsx
// Technical deep-dive page for curious users — all the jargon that doesn't
// belong on the marketing landing page lives here.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "But how does it work, really? — Primordia",
  description: "The full technical picture behind Primordia: WebAuthn, git worktrees, blue-green deploys, SQLite, and every architectural decision.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/5 pt-12">
      <h2 className="font-mono font-bold text-xl text-white mb-4">{title}</h2>
      <div className="text-gray-400 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-sm bg-white/5 text-gray-300 px-1.5 py-0.5 rounded">{children}</code>
  );
}

export default function UnderTheHoodPage() {
  return (
    <div className="min-h-dvh bg-gray-950 text-gray-100">
      <div className="max-w-2xl mx-auto px-6 py-20">
        <Link
          href="/"
          data-id="under-the-hood/back"
          className="font-mono text-sm text-gray-500 hover:text-gray-300 transition-colors mb-14 block"
        >
          ← Back
        </Link>

        <h1 className="font-mono font-black text-3xl sm:text-4xl text-white mb-4 tracking-tight">
          But how does it work, really?
        </h1>
        <p className="text-gray-400 leading-relaxed mb-16">
          The landing page was keeping secrets. Here&apos;s the full technical picture for the curious.
        </p>

        <div className="space-y-12">
          <Section title="Passkeys are WebAuthn / FIDO2">
            <p>
              The &ldquo;passkeys&rdquo; Primordia uses are FIDO2 credentials stored in your
              device&apos;s hardware security enclave — Touch ID, Face ID, Windows Hello, or a
              hardware key. The protocol is WebAuthn (Web Authentication API, a W3C standard).
            </p>
            <p>
              When you log in, your device performs a public-key signature over a
              server-generated challenge. No password is ever transmitted. Credentials are
              cryptographically bound to the origin domain, making them inherently
              phishing-resistant — a credential registered on <InlineCode>example.com</InlineCode>{" "}
              cannot be used on a lookalike site.
            </p>
            <p>
              Sessions are stored in a local SQLite database and expire on logout. There is no
              &ldquo;forgot password&rdquo; flow because there is no password to forget.
            </p>
          </Section>

          <Section title="Change tracking is Git">
            <p>
              Every accepted change becomes a real git commit on the{" "}
              <InlineCode>main</InlineCode> branch. The version history you can roll back to
              from the admin panel is a list of previous git commits — each one is a
              reproducible snapshot of the entire application.
            </p>
            <p>
              Primordia can push those commits to a secondary &ldquo;mirror&rdquo; remote (any
              git server) automatically on each deploy. The read-only git HTTP endpoint lets
              you <InlineCode>git clone</InlineCode> your instance for local inspection or
              backup — push is permanently blocked at the server level.
            </p>
          </Section>

          <Section title="The AI agent runs Claude Code in a git worktree">
            <p>
              When you submit a change proposal, Primordia forks the current codebase into a
              git worktree — a lightweight checkout that shares object storage with the main
              repo but has its own working directory and HEAD. This means the agent can modify
              and build the app in isolation without touching production.
            </p>
            <p>
              Claude Code runs inside that worktree via{" "}
              <InlineCode>@anthropic-ai/claude-agent-sdk</InlineCode>. It edits files, runs
              builds, and commits the result. A dev server boots from the worktree — that&apos;s
              your live preview. If you accept the change, the worktree branch is merged to{" "}
              <InlineCode>main</InlineCode> and a new production build starts. If you reject it,
              the worktree is deleted and nothing changes in production.
            </p>
          </Section>

          <Section title="Zero-downtime deploys via blue-green proxy">
            <p>
              A reverse proxy (a small Node.js process managed by systemd) sits in front of the
              Next.js app. It holds the address of the &ldquo;active slot&rdquo; — whichever
              port the current production build is listening on.
            </p>
            <p>
              On accept, a new production build is compiled and started on a different port.
              When it signals readiness, the proxy atomically updates its active slot pointer.
              All in-flight requests to the old slot complete before it is shut down. From the
              outside, the swap is invisible — no downtime, no dropped connections.
            </p>
          </Section>

          <Section title="The database is SQLite (via bun:sqlite)">
            <p>
              There is no separate database server. A single SQLite file (
              <InlineCode>primordia.db</InlineCode>) stores sessions, users, roles, evolve
              session records, and event logs. Bun&apos;s built-in{" "}
              <InlineCode>bun:sqlite</InlineCode> module provides the adapter — no additional
              dependencies.
            </p>
            <p>
              On accept, the live production database is snapshotted into the new build using
              SQLite&apos;s <InlineCode>VACUUM INTO</InlineCode> command before the proxy swap.
              The new process starts with a fresh copy of the current data, not an empty
              database.
            </p>
          </Section>

          <Section title="Secret encryption">
            <p>
              API keys and credentials submitted through the settings pages are encrypted
              client-side before they are sent to the server. The scheme is hybrid
              envelope encryption: a fresh random 256-bit AES-GCM key encrypts the payload;
              that symmetric key is then wrapped with an RSA-OAEP public key.
            </p>
            <p>
              The server stores only the ciphertext and the wrapped key. It can never decrypt
              them without the RSA private key. This means a database leak exposes no plaintext
              secrets.
            </p>
          </Section>

          <Section title="The tech stack — and why">
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono border-collapse">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pb-3 pr-6 font-semibold">Layer</th>
                    <th className="pb-3 pr-6 font-semibold">Choice</th>
                    <th className="pb-3 font-semibold">Why</th>
                  </tr>
                </thead>
                <tbody className="text-gray-400">
                  {[
                    ["Runtime", "Bun", "Fast, built-in SQLite, TypeScript-native"],
                    ["Framework", "Next.js 16 App Router", "AI models write Next.js well"],
                    ["Language", "TypeScript", "Catches mistakes; AI models understand it"],
                    ["Styling", "Tailwind CSS", "No CSS files; AI writes it accurately"],
                    ["AI API", "Anthropic SDK", "Routes through exe.dev LLM gateway"],
                    ["Database", "SQLite (bun:sqlite)", "Zero config; single file; VACUUM INTO for snapshots"],
                    ["Auth", "WebAuthn passkeys", "No passwords; hardware-backed; phishing-resistant"],
                    ["Hosting", "exe.dev", "Persistent SSH VMs; no container cold-start penalty"],
                  ].map(([layer, choice, why]) => (
                    <tr key={layer} className="border-t border-white/5">
                      <td className="py-2.5 pr-6 text-gray-300 whitespace-nowrap">{layer}</td>
                      <td className="py-2.5 pr-6 whitespace-nowrap">{choice}</td>
                      <td className="py-2.5">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4">
              Every choice here optimizes for one thing: an AI agent should be able to read,
              understand, and modify the codebase with high accuracy. Conventional wisdom about
              scalability is secondary — if your app outgrows SQLite or a single VM, you&apos;ll
              evolve it then.
            </p>
          </Section>
        </div>

        <div className="mt-16 pt-12 border-t border-white/5 flex items-center justify-between text-sm font-mono text-gray-600">
          <Link href="/" className="hover:text-gray-400 transition-colors">← Back to Primordia</Link>
          <Link href="/changelog" className="hover:text-gray-400 transition-colors">Changelog →</Link>
        </div>
      </div>
    </div>
  );
}
