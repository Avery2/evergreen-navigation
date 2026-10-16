#!/usr/bin/env node
/**
 * Build the plugin and copy it into a vault's community-plugins folder.
 *
 * This script never guesses: you must point it at a vault explicitly, either
 * with `--vault <path>` or the `OBSIDIAN_VAULT` environment variable. It also
 * refuses to write anywhere that does not look like an Obsidian vault.
 *
 * Usage:
 *   node scripts/install.mjs --vault "/path/to/My Vault"
 *   node scripts/install.mjs --vault "/path/to/My Vault" --watch
 *   node scripts/install.mjs --vault "/path/to/My Vault" --dry-run
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Files a manually installed Obsidian plugin needs. */
const ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];

const args = process.argv.slice(2);

function readFlag(name) {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

function hasFlag(name) {
	return args.includes(name);
}

if (hasFlag('--help') || hasFlag('-h')) {
	console.log(
		[
			'Build the plugin and copy it into a vault.',
			'',
			'Usage:',
			'  node scripts/install.mjs --vault "/path/to/My Vault"',
			'  node scripts/install.mjs --vault "/path/to/My Vault" --watch',
			'  node scripts/install.mjs --vault "/path/to/My Vault" --dry-run',
			'',
			'Options:',
			'  --vault <path>   Vault root (the folder that contains .obsidian).',
			'                   Falls back to the OBSIDIAN_VAULT environment variable.',
			'  --watch          Rebuild and re-copy whenever src/ changes.',
			'  --dry-run        Show what would happen without writing anything.',
		].join('\n')
	);
	process.exit(0);
}

const vaultArg = readFlag('--vault') ?? process.env.OBSIDIAN_VAULT;
const watch = hasFlag('--watch');
const dryRun = hasFlag('--dry-run');

if (!vaultArg) {
	console.error(
		[
			'No vault given.',
			'',
			'Pass one explicitly, for example:',
			'  npm run install:vault -- --vault "/Users/you/Documents/My Vault"',
			'',
			'Or set OBSIDIAN_VAULT once and re-use it.',
			'Run with --help for all options.',
		].join('\n')
	);
	process.exit(1);
}

const vault = path.resolve(vaultArg);
const obsidianDir = path.join(vault, '.obsidian');
const pluginDir = path.join(obsidianDir, 'plugins', 'evergreen-navigation');

if (!existsSync(vault)) {
	console.error(`Vault path does not exist: ${vault}`);
	process.exit(1);
}

if (!existsSync(obsidianDir)) {
	console.error(
		[
			`No .obsidian folder in ${vault}.`,
			'',
			'That usually means this is not a vault. In Obsidian, open the vault you',
			'want and check Settings -> About -> Vault path (or use "Show vault in Finder").',
		].join('\n')
	);
	process.exit(1);
}

const manifest = JSON.parse(await readFile(path.join(projectRoot, 'manifest.json'), 'utf8'));

console.log(`Vault:  ${vault}`);
console.log(`Target: ${pluginDir}`);
console.log(`Plugin: ${manifest.name} (${manifest.id}) v${manifest.version}`);
if (dryRun) console.log('Dry run: nothing will be written.');
console.log('');

async function copyArtifacts() {
	if (!dryRun) await mkdir(pluginDir, { recursive: true });

	for (const name of ARTIFACTS) {
		const from = path.join(projectRoot, name);
		if (!existsSync(from)) continue;
		if (!dryRun) await copyFile(from, path.join(pluginDir, name));
		console.log(`  ${dryRun ? 'would copy' : 'copied'} ${name}`);
	}
}

/** Rebuild with esbuild and copy the result. */
async function buildAndCopy() {
	await esbuild.build({
		entryPoints: [path.join(projectRoot, 'src', 'main.ts')],
		bundle: true,
		external: [
			'obsidian',
			'electron',
			'@codemirror/autocomplete',
			'@codemirror/collab',
			'@codemirror/commands',
			'@codemirror/language',
			'@codemirror/lint',
			'@codemirror/search',
			'@codemirror/state',
			'@codemirror/view',
			'@lezer/common',
			'@lezer/highlight',
			'@lezer/lr',
		],
		format: 'cjs',
		target: 'es2018',
		logLevel: 'warning',
		treeShaking: true,
		outfile: path.join(projectRoot, 'main.js'),
		minify: true,
	});

	console.log(`[${new Date().toLocaleTimeString()}] built main.js`);
	await copyArtifacts();
}

if (watch) {
	await buildAndCopy();
	const context = await esbuild.context({
		entryPoints: [path.join(projectRoot, 'src', 'main.ts')],
		bundle: true,
		external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
		format: 'cjs',
		target: 'es2018',
		logLevel: 'warning',
		outfile: path.join(projectRoot, 'main.js'),
		minify: true,
		plugins: [
			{
				name: 'copy-to-vault',
				setup(build) {
					build.onEnd(async (result) => {
						if (result.errors.length > 0) return;
						console.log(`[${new Date().toLocaleTimeString()}] rebuilt`);
						await copyArtifacts();
						console.log('  -> reload the plugin in Obsidian (see README)');
					});
				},
			},
		],
	});

	await context.watch();
	console.log('\nWatching src/ — press Ctrl+C to stop.');
} else {
	await buildAndCopy();
	console.log('\nDone. Reload the plugin in Obsidian (see README).');
}
