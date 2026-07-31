"use client";

import dynamic from "next/dynamic";

const CoreApiScalarReference = dynamic(() => import("./CoreApiScalarReference"), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-screen items-center justify-center bg-[#0f0f0f] px-6 text-center text-gray-300">
      <div>
        <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Primordia Core API</p>
        <h1 className="mt-3 text-2xl font-semibold text-white">Loading API reference…</h1>
        <p className="mt-2 max-w-md text-sm text-gray-400">
          Scalar is loaded lazily so the preview server can return the page shell quickly during development.
        </p>
      </div>
    </main>
  ),
});

export default function CoreApiScalarClient() {
  return <CoreApiScalarReference />;
}
