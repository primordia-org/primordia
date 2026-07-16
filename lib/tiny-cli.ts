export type CliValue = string | boolean | undefined;

export interface CliParsedArgs {
  _: string[];
  [key: string]: CliValue | string[];
}

export interface CliCompletionContext {
  words: string[];
  current: string;
  previous: string | undefined;
  commandPath: string[];
}

export type CliCompletionSource = (context: CliCompletionContext) => string[] | Promise<string[]>;

export interface CliOptionDef {
  name: string;
  alias?: string;
  type: 'boolean' | 'string';
  valueHint?: string;
  description: string;
  complete?: CliCompletionSource;
}

export interface CliArgumentDef {
  name: string;
  required?: boolean;
  valueHint?: string;
  description: string;
  complete?: CliCompletionSource;
}

export interface CliCommandDef {
  name: string;
  description: string;
  options?: CliOptionDef[];
  arguments?: CliArgumentDef[];
  subcommands?: CliCommandDef[];
  complete?: CliCompletionSource;
  hidden?: boolean;
  run?: (context: { args: CliParsedArgs; rawArgs: string[]; commandPath: string[] }) => unknown | Promise<unknown>;
}

interface ResolvedCommand {
  command: CliCommandDef;
  path: string[];
  remaining: string[];
}

function visibleSubcommands(command: CliCommandDef): CliCommandDef[] {
  return command.subcommands?.filter((subcommand) => !subcommand.hidden) ?? [];
}

function optionDisplay(option: CliOptionDef): string {
  const long = `--${option.name}${option.type === 'string' ? ` <${option.valueHint ?? option.name}>` : ''}`;
  return option.alias ? `-${option.alias}, ${long}` : long;
}

function commandUsages(command: CliCommandDef, prefix = command.name): string[] {
  const subcommands = visibleSubcommands(command);
  if (subcommands.length === 0) {
    const optionPart = command.options?.length ? ' [options]' : '';
    const argPart = (command.arguments ?? []).map((arg) => arg.required ? ` <${arg.valueHint ?? arg.name}>` : ` [${arg.valueHint ?? arg.name}]`).join('');
    return [`${prefix}${optionPart}${argPart}`];
  }
  return subcommands.flatMap((subcommand) => commandUsages(subcommand, `${prefix} ${subcommand.name}`));
}

function flattenCommands(command: CliCommandDef, prefix = command.name): Array<{ path: string; command: CliCommandDef }> {
  const rows: Array<{ path: string; command: CliCommandDef }> = [];
  for (const subcommand of visibleSubcommands(command)) {
    const path = `${prefix} ${subcommand.name}`;
    rows.push({ path, command: subcommand });
    rows.push(...flattenCommands(subcommand, path));
  }
  return rows;
}

function padRight(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - value.length));
}

function wrapText(text: string, indent: string, width = 100): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (indent.length + line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line += ` ${word}`;
    }
  }
  if (line) lines.push(line);
  return lines.map((entry) => `${indent}${entry}`).join('\n');
}

export function renderCliHelp(root: CliCommandDef): string {
  const usages = commandUsages(root);
  const commands = flattenCommands(root).filter(({ command }) => command.run || visibleSubcommands(command).length > 0);
  const commandWidth = Math.max(...commands.map(({ path }) => path.length), 0);
  const allCommands = [root, ...flattenCommands(root).map(({ command }) => command)];
  const optionRows = allCommands.flatMap((command) => (command.options ?? []).map((option) => ({ command, option })));
  const optionWidth = Math.max(...optionRows.map(({ option }) => optionDisplay(option).length), 0);

  const lines: string[] = [];
  lines.push(root.description);
  lines.push('');
  lines.push('Usage:');
  for (const usage of usages) lines.push(`  ${usage}`);
  lines.push('');
  lines.push('Commands:');
  for (const { path, command } of commands) {
    lines.push(`  ${padRight(path, commandWidth)}  ${command.description}`);
  }

  if (optionRows.length > 0) {
    lines.push('');
    lines.push('Options:');
    const seen = new Set<string>();
    for (const { option } of optionRows) {
      const key = optionDisplay(option);
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  ${padRight(key, optionWidth)}  ${option.description}`);
    }
  }

  lines.push('');
  lines.push('Completion:');
  lines.push('  Print the bash completion script:');
  lines.push('    bun run primordia completion bash');
  lines.push('  Enable it for the current shell:');
  lines.push('    source <(bun run --silent primordia completion bash)');
  lines.push('  To enable it for future shells, add that source line to ~/.bashrc.');
  lines.push('');
  lines.push('Notes:');
  lines.push(wrapText("  Thread and server commands resolve the current thread from cwd. Run them from inside a thread worktree.", ''));
  lines.push(wrapText("  Pass '-' as the request to read request text from stdin.", ''));
  return lines.join('\n');
}

function resolveCommand(root: CliCommandDef, rawArgs: string[]): ResolvedCommand {
  let command = root;
  const path = [root.name];
  let index = 0;
  while (index < rawArgs.length) {
    const token = rawArgs[index];
    if (token.startsWith('-')) break;
    const next = visibleSubcommands(command).find((subcommand) => subcommand.name === token);
    if (!next) break;
    command = next;
    path.push(next.name);
    index += 1;
  }
  return { command, path, remaining: rawArgs.slice(index) };
}

function assignOption(args: CliParsedArgs, option: CliOptionDef, value: string | boolean): void {
  args[option.name] = value;
  if (option.alias) args[option.alias] = value;
}

export function parseCliArgs(command: CliCommandDef, rawArgs: string[]): CliParsedArgs {
  const args: CliParsedArgs = { _: [] };
  const options = command.options ?? [];
  const longOptions = new Map(options.map((option) => [option.name, option]));
  const shortOptions = new Map(options.filter((option) => option.alias).map((option) => [option.alias!, option]));
  let positionalOnly = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (positionalOnly) {
      args._.push(token);
      continue;
    }
    if (token === '--') {
      positionalOnly = true;
      continue;
    }
    if (token === '-' || !token.startsWith('-')) {
      args._.push(token);
      continue;
    }

    if (token.startsWith('--')) {
      const [rawName, inlineValue] = token.slice(2).split('=', 2);
      const negated = rawName.startsWith('no-');
      const name = negated ? rawName.slice(3) : rawName;
      const option = longOptions.get(name);
      if (!option) throw new Error(`Unknown option: --${rawName}`);
      if (negated && option.type !== 'boolean') throw new Error(`--${rawName} is only valid for boolean options`);
      if (option.type === 'boolean') {
        assignOption(args, option, !negated);
      } else if (token.includes('=')) {
        if (!inlineValue) throw new Error(`--${name} requires a value`);
        assignOption(args, option, inlineValue);
      } else {
        const next = rawArgs[index + 1];
        if (!next || (next.startsWith('-') && next !== '-')) throw new Error(`--${name} requires a value`);
        assignOption(args, option, next);
        index += 1;
      }
      continue;
    }

    const shortNames = token.slice(1).split('');
    if (shortNames.length > 1) throw new Error(`Unknown option: ${token}. Use separate short flags instead.`);
    const [shortName] = shortNames;
    const option = shortOptions.get(shortName);
    if (!option) throw new Error(`Unknown option: -${shortName}`);
    if (option.type === 'boolean') {
      assignOption(args, option, true);
    } else {
      const next = rawArgs[index + 1];
      if (!next || (next.startsWith('-') && next !== '-')) throw new Error(`-${shortName} requires a value`);
      assignOption(args, option, next);
      index += 1;
    }
  }

  const argumentDefs = command.arguments ?? [];
  for (let index = 0; index < argumentDefs.length; index += 1) {
    const argument = argumentDefs[index];
    const value = args._[index];
    if (value === undefined) {
      if (argument.required) throw new Error(`Missing required argument: ${argument.name}`);
    } else {
      args[argument.name] = value;
    }
  }
  return args;
}

async function completeCli(root: CliCommandDef, rawWords: string[]): Promise<string[]> {
  const words = rawWords[0] === '--' ? rawWords.slice(1) : rawWords;
  const compCword = Number(process.env.COMP_CWORD);
  const currentIndex = Number.isFinite(compCword) ? Math.max(0, compCword - 1) : Math.max(0, words.length - 1);
  const current = words[currentIndex] ?? '';
  const previous = currentIndex > 0 ? words[currentIndex - 1] : undefined;
  const wordsBeforeCurrent = words.slice(0, currentIndex);
  const resolved = resolveCommand(root, wordsBeforeCurrent);
  const command = resolved.command;
  const commandPath = resolved.path;
  const context: CliCompletionContext = { words, current, previous, commandPath };

  const previousOption = previous?.startsWith('--')
    ? command.options?.find((option) => option.name === previous.slice(2))
    : previous?.startsWith('-')
      ? command.options?.find((option) => option.alias === previous.slice(1))
      : undefined;
  if (previousOption?.type === 'string') {
    return previousOption.complete ? filterCompletions(await previousOption.complete(context), current) : [];
  }

  if (current.startsWith('-')) {
    const optionCompletions = (command.options ?? []).flatMap((option) => [
      `--${option.name}`,
      ...(option.alias ? [`-${option.alias}`] : []),
    ]);
    return filterCompletions(optionCompletions, current);
  }

  if (command === root && wordsBeforeCurrent.length === 1 && wordsBeforeCurrent[0] === 'completion') {
    return filterCompletions(['bash'], current);
  }

  const subcommandCompletions = visibleSubcommands(command).map((subcommand) => subcommand.name);
  if (command === root) subcommandCompletions.push('completion');
  const commandCompletions = command.complete ? await command.complete(context) : [];
  const argumentIndex = resolved.remaining.filter((word) => !word.startsWith('-')).length;
  const argument = command.arguments?.[argumentIndex];
  const argumentCompletions = argument?.complete ? await argument.complete(context) : [];
  return filterCompletions([...subcommandCompletions, ...commandCompletions, ...argumentCompletions], current);
}

function filterCompletions(completions: string[], current: string): string[] {
  return [...new Set(completions)].filter((completion) => completion.startsWith(current)).sort();
}

export function renderBashCompletion(commandName: string): string {
  const functionName = `_${commandName.replace(/[^a-zA-Z0-9_]/g, '_')}_completion`;
  return [
    '# Keep colon-containing values like builtin:claude-code-gateway as one completion word.',
    'COMP_WORDBREAKS="${COMP_WORDBREAKS//:}"',
    `${functionName}() {`,
    '  local line words cword',
    '  line="${COMP_LINE:0:COMP_POINT}"',
    '  read -r -a words <<< "$line"',
    '  if [[ "$line" =~ [[:space:]]$ ]]; then',
    '    words+=("")',
    '  fi',
    '  cword=$((${#words[@]} - 1))',
    '  mapfile -t COMPREPLY < <(COMP_CWORD="$cword" bun run --silent ' + commandName + ' __complete -- "${words[@]:1}")',
    '}',
    `complete -F ${functionName} ${commandName}`,
    '',
  ].join('\n');
}

export async function runCli(root: CliCommandDef, rawArgs: string[]): Promise<void> {
  if (rawArgs[0] === '__complete') {
    const completions = await completeCli(root, rawArgs.slice(1));
    console.log(completions.join('\n'));
    return;
  }

  if (rawArgs.length === 2 && rawArgs[0] === 'completion' && rawArgs[1] === 'bash') {
    console.log(renderBashCompletion(root.name));
    return;
  }

  if (rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs.length === 0) {
    console.log(renderCliHelp(root));
    return;
  }

  const resolved = resolveCommand(root, rawArgs);
  if (visibleSubcommands(resolved.command).length > 0 && !resolved.command.run) {
    throw new Error(`No command specified for ${resolved.path.join(' ')}`);
  }
  if (!resolved.command.run) throw new Error(`Unknown command: ${resolved.remaining[0] ?? rawArgs.join(' ')}`);
  const args = parseCliArgs(resolved.command, resolved.remaining);
  await resolved.command.run({ args, rawArgs: resolved.remaining, commandPath: resolved.path });
}
