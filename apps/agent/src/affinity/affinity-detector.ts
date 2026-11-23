/**
 * CRELUNE Windows Creative Agent — Affinity 3.3 Environment Detector (Read-Only)
 *
 * Checks the actual installed Windows Affinity environment without modifying
 * global Affinity preferences:
 * - Verifies `%LOCALAPPDATA%\Microsoft\WindowsApps\Affinity.exe` execution alias.
 * - Queries installed `Canva.Affinity` MSIX package version via `Get-AppxPackage`.
 * - Reads (READ-ONLY) `ScriptingPreferences.xml` and `MCPPreferences.xml` to report
 *   whether scripting and MCP are enabled or disabled by default.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface AffinityEnvironmentReport {
  platform: NodeJS.Platform;
  installed: boolean;
  packageName: string | null;
  version: string | null;
  executableAliasPath: string | null;
  aliasExists: boolean;
  scriptingEnabled: boolean | null;
  mcpServerEnabled: boolean | null;
  notes: string[];
}

function parseXmlBooleanTag(xml: string, tagName: string): boolean | null {
  const match = new RegExp(`<${tagName}>\\s*(True|False)\\s*</${tagName}>`, 'i').exec(
    xml
  );
  if (!match) return null;
  return match[1]!.toLowerCase() === 'true';
}

function queryAffinityAppxPackage(): Promise<{
  name: string | null;
  version: string | null;
}> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ name: null, version: null });
  }

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$p = Get-AppxPackage -Name "*Affinity*" -ErrorAction SilentlyContinue | Select-Object -First 1 Name, Version; if ($p) { "$($p.Name)|$($p.Version)" }',
      ],
      { shell: false, windowsHide: true, timeout: 10_000 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve({ name: null, version: null });
          return;
        }
        const [name, version] = stdout.trim().split('|');
        resolve({
          name: name?.trim() || null,
          version: version?.trim() || null,
        });
      }
    );
  });
}

async function readXmlIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

export async function detectInstalledAffinityEnvironment(): Promise<AffinityEnvironmentReport> {
  const notes: string[] = [];
  if (process.platform !== 'win32') {
    notes.push('Non-Windows platform detected; Affinity Windows desktop launch is unavailable.');
    return {
      platform: process.platform,
      installed: false,
      packageName: null,
      version: null,
      executableAliasPath: null,
      aliasExists: false,
      scriptingEnabled: null,
      mcpServerEnabled: null,
      notes,
    };
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const aliasPath = localAppData
    ? path.join(localAppData, 'Microsoft', 'WindowsApps', 'Affinity.exe')
    : null;

  let aliasExists = false;
  if (aliasPath) {
    try {
      await fs.access(aliasPath);
      aliasExists = true;
    } catch {
      aliasExists = false;
    }
  }

  const pkg = await queryAffinityAppxPackage();
  const userHome = os.homedir();
  const settingsRoot = path.join(userHome, '.affinity', 'Affinity', '3.0', 'Settings');
  const [scriptingXml, mcpXml] = await Promise.all([
    readXmlIfPresent(path.join(settingsRoot, 'ScriptingPreferences.xml')),
    readXmlIfPresent(path.join(settingsRoot, 'MCPPreferences.xml')),
  ]);

  const scriptingEnabled = scriptingXml
    ? parseXmlBooleanTag(scriptingXml, 'ScriptingEnabled')
    : null;
  const mcpServerEnabled = mcpXml
    ? parseXmlBooleanTag(mcpXml, 'EnableMCPServer')
    : null;

  const installed = Boolean(pkg.version || aliasExists);
  if (!installed) {
    notes.push('Affinity desktop installation not detected; agent will operate in MANUAL workspace preparation mode.');
  } else {
    notes.push(`Detected Affinity ${pkg.version ?? 'unknown version'} (App Execution Alias: ${aliasExists ? 'available' : 'missing'}).`);
  }

  if (scriptingEnabled === false) {
    notes.push('Affinity ScriptingPreferences.xml has ScriptingEnabled=False (left untouched per safety policy).');
  }
  if (mcpServerEnabled === false) {
    notes.push('Affinity MCPPreferences.xml has EnableMCPServer=False (left untouched per safety policy).');
  }

  return {
    platform: process.platform,
    installed,
    packageName: pkg.name,
    version: pkg.version,
    executableAliasPath: aliasExists ? aliasPath : null,
    aliasExists,
    scriptingEnabled,
    mcpServerEnabled,
    notes,
  };
}
