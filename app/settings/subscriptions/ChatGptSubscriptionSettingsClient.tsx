"use client";

import { ChatGptSubscriptionAuthCard } from "@/components/ChatGptSubscriptionAuthCard";

export default function ChatGptSubscriptionSettingsClient({ initialCiphertext }: { initialCiphertext?: string | null }) {
  return <ChatGptSubscriptionAuthCard initialCiphertext={initialCiphertext} />;
}
