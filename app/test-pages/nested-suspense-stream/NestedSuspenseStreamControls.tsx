"use client";

import { useMemo, useState } from "react";

type Demo = {
  label: string;
  text: string;
};

export function NestedSuspenseStreamControls({
  demos,
  initialText,
  initialDelay,
}: {
  demos: Demo[];
  initialText: string;
  initialDelay: number;
}) {
  const initialDemoIndex = useMemo(
    () => demos.findIndex((demo) => demo.text === initialText),
    [demos, initialText],
  );
  const [selectedDemo, setSelectedDemo] = useState(initialDemoIndex >= 0 ? String(initialDemoIndex) : "custom");
  const [text, setText] = useState(initialText);

  return (
    <form className="flex flex-col gap-3 lg:flex-row lg:items-end" method="GET">
      <div className="min-w-0 flex-1">
        <h1 className="text-sm font-semibold text-gray-100">Recursive Suspense Tail Test Page</h1>
        <p className="mt-1 text-xs text-gray-500">
          Choose a demo or edit the text. Each Suspense boundary resolves to one ANSI-rendered line plus the next
          Suspense boundary, then stops when the text ends.
        </p>
        <label className="mt-3 flex max-w-xs flex-col gap-1 text-xs text-gray-400">
          <span>Demo</span>
          <select
            value={selectedDemo}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedDemo(value);
              if (value !== "custom") setText(demos[Number(value)].text);
            }}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
          >
            {demos.map((demo, index) => (
              <option key={demo.label} value={index}>
                {demo.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        <textarea
          name="text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSelectedDemo("custom");
          }}
          rows={8}
          className="mt-3 w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-gray-200 outline-none focus:border-violet-500"
          spellCheck={false}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          <span>Delay</span>
          <select
            name="delay"
            defaultValue={initialDelay}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
          >
            {[0, 20, 40, 80, 120, 200, 500].map((value) => (
              <option key={value} value={value}>
                {value}ms / line
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
        >
          Start stream
        </button>
      </div>
    </form>
  );
}
