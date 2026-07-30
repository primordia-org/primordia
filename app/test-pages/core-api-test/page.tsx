import Link from "next/link";
import CoreApiTestClient from "./CoreApiTestClient";

export const metadata = {
  title: "Core API Test",
  description: "Exercise the Primordia Core route-action API with a web API key."
};

export default function CoreApiTestPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-100">🧪 Core API Test</h1>
            <p className="mt-0.5 text-xs text-gray-500">Test Primordia Core POST route actions with a revokable web API key.</p>
          </div>
          <Link href="/test-pages" className="text-sm text-gray-400 hover:text-gray-200">← Test pages</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <CoreApiTestClient />
      </main>
    </div>
  );
}
