"use client";

import { Activity, BellRing, ShieldAlert, Sparkles } from "lucide-react";
import WebPushCategoryButton from "@/components/WebPushCategoryButton";
import type { WebPushCategory } from "@/lib/db/types";

const CATEGORIES: Array<{
  category: WebPushCategory;
  title: string;
  description: string;
  icon: "shield" | "sparkles" | "activity";
}> = [
  {
    category: "security-vulnerabilities",
    title: "Security Vulnerabilities",
    description: "Get notified when scheduled dependency audits find high or critical vulnerabilities so you can open Dependency Security and start a fix session.",
    icon: "shield",
  },
  {
    category: "primordia-updates",
    title: "Primordia Updates",
    description: "Get notified when scheduled update checks find upstream Primordia commits so you can review the changelog and create a merge session.",
    icon: "sparkles",
  },
  {
    category: "server-health-alerts",
    title: "Server Health Alerts",
    description: "Get notified when Primordia captures diagnostics for possible CPU leaks or memory leaks so you can open Server Health and start a fix session.",
    icon: "activity",
  },
];

export default function PushNotificationsSettingsClient({
  canStartThreads,
  initialSubscribedCategories,
}: {
  canStartThreads: boolean;
  initialSubscribedCategories: WebPushCategory[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-100">
          <BellRing className="h-6 w-6 text-violet-300" />
          Push Notifications
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Choose which actionable Primordia events should send browser push notifications to this account.
        </p>
      </div>

      {!canStartThreads && (
        <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Push notification categories are currently available to users with thread access.
        </div>
      )}

      <div className="space-y-3">
        {CATEGORIES.map((item) => {
          const Icon = item.icon === "shield" ? ShieldAlert : item.icon === "activity" ? Activity : Sparkles;
          return (
            <div key={item.category} className="rounded-xl border border-gray-700 bg-gray-900 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <div className="rounded-lg bg-violet-500/10 p-2 text-violet-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-gray-100">{item.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-gray-400">{item.description}</p>
                  </div>
                </div>
                {canStartThreads && (
                  <WebPushCategoryButton
                    category={item.category}
                    initialSubscribed={initialSubscribedCategories.includes(item.category)}
                    className="shrink-0"
                    subscribeLabel="Subscribe"
                    unsubscribeLabel="Unsubscribe"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
