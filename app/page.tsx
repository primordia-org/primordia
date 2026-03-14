// app/page.tsx — The main entry point for Primordia
// This page renders the chat interface with an optional "evolve" mode toggle.
// When a user switches to evolve mode, their message is captured as a GitHub Issue
// instead of being sent to Claude for a normal conversation.

import ChatInterface from "@/components/ChatInterface";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <ChatInterface />
    </main>
  );
}
