import process from 'process';
import type { Readable, Writable } from 'stream';

export type PrimordiaCliContext = {
  cwd: () => string;
  env: NodeJS.ProcessEnv;
  stdin: Readable & { isTTY?: boolean; resume?: () => unknown; once: Readable['once'] };
  stdout: Writable & { once: Writable['once']; write: Writable['write'] };
  stderr: Writable & { once: Writable['once']; write: Writable['write'] };
  onSignal: (signal: NodeJS.Signals, listener: () => void) => void;
  exit: (code: number) => never;
};

export function createDefaultCliContext(): PrimordiaCliContext {
  return {
    cwd: () => process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    onSignal: (signal, listener) => process.once(signal, listener),
    exit: (code) => process.exit(code),
  };
}
