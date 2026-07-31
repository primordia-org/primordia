"use client";

import dynamic from "next/dynamic";

const ThreadView = dynamic(() => import("./ThreadView"), { ssr: false });

export function ThreadViewClient({ sessionId, isProduction }: { sessionId: string; isProduction: boolean }) {
  return <ThreadView sessionId={sessionId} isProduction={isProduction} />;
}
