#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_PATH = '/tmp/pi-resolve-log.txt';
const lines = [];

function log(msg) {
  lines.push(msg);
  console.log(msg);
}

function logSection(title) {
  log(`\n${'='.repeat(60)}`);
  log(`  ${title}`);
  log('='.repeat(60));
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch (err) {
    return `(error: ${err.message?.split('\n')[0] || 'unknown'})`;
  }
}

// === Section 1: Shell Environment ===
logSection('1. Shell Environment');
log(`  cwd: ${process.cwd()}`);
log(`  which pi: ${run('which pi 2>/dev/null || echo "not found"')}`);
log(`  type pi: ${run('type pi 2>/dev/null || echo "not found"')}`);

// === Section 2: Shell RC files for pi aliases ===
logSection('2. Shell RC Files (pi alias/wrapper detection)');
const rcFiles = [
  join(homedir(), '.zshrc'),
  join(homedir(), '.bashrc'),
  join(homedir(), '.zprofile'),
  join(homedir(), '.bash_profile'),
];
for (const rc of rcFiles) {
  if (existsSync(rc)) {
    const content = readFileSync(rc, 'utf-8');
    const piLines = content.split('\n').filter(line => /\bpi\b/.test(line) && !line.trim().startsWith('#'));
    if (piLines.length > 0) {
      log(`\n  [${rc}]:`);
      for (const line of piLines.slice(0, 10)) {
        log(`    ${line.trim()}`);
      }
      if (piLines.length > 10) log(`    ... (${piLines.length - 10} more lines)`);
    } else {
      log(`  [${rc}]: no pi references`);
    }
  } else {
    log(`  [${rc}]: not found`);
  }
}

// === Section 3: SettingsManager via dynamic import ===
logSection('3. SettingsManager Analysis (pi dist)');
try {
  const piDistPath = '/Users/__blitzzz/.hermes/node/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
  log(`  Importing from: ${piDistPath}`);
  const mod = await import(piDistPath);
  const { SettingsManager } = mod;
  
  if (!SettingsManager) {
    log('  ERROR: SettingsManager not found in exports');
  } else {
    log('  SettingsManager imported successfully');
    const cwd = process.cwd();
    log(`  Calling SettingsManager.create("${cwd}")`);
    const sm = SettingsManager.create(cwd);
    
    const enabledModels = sm.getEnabledModels();
    const defaultModel = sm.getDefaultModel();
    const defaultProvider = sm.getDefaultProvider();
    
    log(`\n  getEnabledModels(): ${JSON.stringify(enabledModels, null, 2)}`);
    log(`  getDefaultModel(): ${defaultModel || '(none)'}`);
    log(`  getDefaultProvider(): ${defaultProvider || '(none)'}`);
    
    // Check for fireworks.ant match
    const antPattern = /fireworks\.ant/;
    const matchingModels = (enabledModels || []).filter(m => antPattern.test(m));
    log(`\n  fireworks.ant matches: ${matchingModels.length > 0 ? matchingModels.join(', ') : 'NONE'}`);
  }
} catch (err) {
  log(`  ERROR importing SettingsManager: ${err.message}`);
  log(`  Stack: ${err.stack?.split('\n').slice(0, 5).join('\n  ')}`);
}

// === Section 4: Project .pi/settings.json ===
logSection('4. Project .pi/settings.json');
const projectSettingsPath = join(process.cwd(), '.pi', 'settings.json');
if (existsSync(projectSettingsPath)) {
  try {
    const raw = readFileSync(projectSettingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    log(`  Path: ${projectSettingsPath}`);
    log(`  enabledModels: ${JSON.stringify(parsed.enabledModels, null, 2) || '(not set)'}`);
    log(`  defaultModel: ${parsed.defaultModel || '(not set)'}`);
    log(`\n  Full contents:\n${raw}`);
  } catch (err) {
    log(`  ERROR reading settings.json: ${err.message}`);
  }
} else {
  log(`  No .pi/settings.json found at ${projectSettingsPath}`);
}

// === Section 5: Global settings ===
logSection('5. Global Settings (~/.pi/agent/settings.json)');
const globalSettingsPath = join(homedir(), '.pi', 'agent', 'settings.json');
if (existsSync(globalSettingsPath)) {
  try {
    const raw = readFileSync(globalSettingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    log(`  Path: ${globalSettingsPath}`);
    log(`  enabledModels: ${JSON.stringify(parsed.enabledModels, null, 2) || '(not set)'}`);
    log(`  defaultModel: ${parsed.defaultModel || '(not set)'}`);
    log(`  flowModelConfigs: ${JSON.stringify(parsed.flowModelConfigs, null, 2) || '(not set)'}`);
  } catch (err) {
    log(`  ERROR reading global settings: ${err.message}`);
  }
} else {
  log(`  No global settings found at ${globalSettingsPath}`);
}

// Write log file
logSection('DONE');
log(`  Log written to: ${LOG_PATH}`);
writeFileSync(LOG_PATH, lines.join('\n'), 'utf-8');
