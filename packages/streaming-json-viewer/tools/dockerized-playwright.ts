import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { resolve as resolvePath } from 'node:path';
import { promisify } from 'node:util';

import { defineBrowserProvider } from '@vitest/browser';
import {
  PlaywrightBrowserProvider,
  playwright,
  type PlaywrightProviderOptions,
} from '@vitest/browser-playwright';
import type {
  BrowserProvider,
  BrowserProviderOption,
  CDPSession,
  TestProject,
} from 'vitest/node';

const execFileAsync = promisify(execFile);

const SERVER_PORT_IN_CONTAINER = 5555;
const STARTUP_TIMEOUT_MS = 30_000;

function isDockerActive(): boolean {
  return process.platform !== 'linux' && process.env.SJV_DOCKER !== '0';
}

type ResolvePathData = {
  arg: string;
  ext: string;
  browserName: string;
  platform: NodeJS.Platform;
  root: string;
  screenshotDirectory: string;
  attachmentsDir: string;
  testFileDirectory: string;
  testFileName: string;
};

/**
 * `toMatchScreenshot.resolveScreenshotPath` override that pins the platform
 * segment to `linux` whenever the dockerized provider is active. Without this,
 * `pnpm test` on macOS writes `*-darwin.png` (host platform) but the bytes
 * came from Linux Chromium — and CI then looks for `*-linux.png`.
 */
export function resolveDockerScreenshotPath(data: ResolvePathData): string {
  const platform = isDockerActive() ? 'linux' : data.platform;
  return resolvePath(
    data.root,
    data.testFileDirectory,
    data.screenshotDirectory,
    data.testFileName,
    `${data.arg}-${data.browserName}-${platform}${data.ext}`,
  );
}

/** Companion to {@link resolveDockerScreenshotPath} for diff/actual artifacts. */
export function resolveDockerDiffPath(data: ResolvePathData): string {
  const platform = isDockerActive() ? 'linux' : data.platform;
  return resolvePath(
    data.root,
    data.attachmentsDir,
    data.testFileDirectory,
    data.testFileName,
    `${data.arg}-${data.browserName}-${platform}${data.ext}`,
  );
}

export interface DockerizedPlaywrightOptions extends PlaywrightProviderOptions {
  image?: string;
  containerName?: string;
}

export function dockerizedPlaywright(
  options: DockerizedPlaywrightOptions = {},
): BrowserProviderOption<DockerizedPlaywrightOptions> {
  if (!isDockerActive()) {
    return playwright(options) as BrowserProviderOption<DockerizedPlaywrightOptions>;
  }
  return defineBrowserProvider<DockerizedPlaywrightOptions>({
    name: 'dockerized-playwright',
    supportedBrowser: ['chromium', 'firefox', 'webkit'],
    options,
    providerFactory(project) {
      return new DockerizedPlaywrightProvider(project, options);
    },
  });
}

class DockerizedPlaywrightProvider implements BrowserProvider {
  name = 'dockerized-playwright';
  supportsParallelism = true;

  private inner: PlaywrightBrowserProvider;
  private containerName: string | null = null;
  private dockerReady: Promise<void> | null = null;
  private signalHandler: (() => void) | null = null;

  constructor(project: TestProject, options: DockerizedPlaywrightOptions) {
    this.inner = new PlaywrightBrowserProvider(project, {
      ...options,
      connectOptions: {
        exposeNetwork: '<loopback>',
        ...options.connectOptions,
        wsEndpoint: 'ws://invalid.local:0/__placeholder__',
      },
    });
  }

  get mocker() {
    return this.inner.mocker;
  }

  get initScripts() {
    return this.inner.initScripts;
  }

  getCommandsContext(sessionId: string): Record<string, unknown> {
    return this.inner.getCommandsContext(sessionId);
  }

  getPage(sessionId: string) {
    return this.inner.getPage(sessionId);
  }

  async openPage(
    sessionId: string,
    url: string,
    options: { parallel: boolean },
  ): Promise<void> {
    await this.ensureDocker();
    return this.inner.openPage(sessionId, url, options);
  }

  async getCDPSession(sessionId: string): Promise<CDPSession> {
    await this.ensureDocker();
    return this.inner.getCDPSession(sessionId);
  }

  async close(): Promise<void> {
    try {
      await this.inner.close();
    } finally {
      await this.stopContainer();
      if (this.signalHandler) {
        process.off('SIGINT', this.signalHandler);
        process.off('SIGTERM', this.signalHandler);
        this.signalHandler = null;
      }
    }
  }

  private ensureDocker(): Promise<void> {
    if (this.dockerReady) return this.dockerReady;
    this.dockerReady = this.startDocker();
    return this.dockerReady;
  }

  private async startDocker(): Promise<void> {
    const playwrightVersion = resolvePlaywrightVersion();
    const image =
      process.env.SJV_DOCKER_IMAGE ??
      `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;

    await ensureDockerDaemon();
    await ensureImage(image);

    const hostPort = await getFreePort();
    this.containerName = `vitest-pw-${process.pid}-${Date.now().toString(36)}`;

    this.signalHandler = () => {
      // best-effort sync cleanup on Ctrl-C; the container's `--rm` will GC eventually
      if (this.containerName) {
        try {
          spawn('docker', ['rm', '-f', this.containerName], {
            stdio: 'ignore',
            detached: true,
          }).unref();
        } catch {
          // ignore
        }
      }
    };
    process.once('SIGINT', this.signalHandler);
    process.once('SIGTERM', this.signalHandler);

    await startContainer(image, this.containerName, hostPort);
    await waitForContainerLog(this.containerName, /Listening on ws:\/\//, STARTUP_TIMEOUT_MS);

    // The inner provider reads connectOptions.wsEndpoint lazily when openBrowser
    // is called from the first openPage. Mutating it here is safe.
    const innerOptions = (this.inner as unknown as { options: PlaywrightProviderOptions }).options;
    innerOptions.connectOptions!.wsEndpoint = `ws://127.0.0.1:${hostPort}/`;
  }

  private async stopContainer(): Promise<void> {
    if (!this.containerName) return;
    const name = this.containerName;
    this.containerName = null;
    try {
      await execFileAsync('docker', ['rm', '-f', name]);
    } catch {
      // container may already be gone
    }
  }
}

function resolvePlaywrightVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('playwright/package.json') as { version: string };
  return pkg.version;
}

async function ensureDockerDaemon(): Promise<void> {
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}']);
  } catch (err) {
    const message =
      err instanceof Error && err.message.includes('ENOENT')
        ? 'Docker CLI not found on PATH.'
        : 'Cannot reach the Docker daemon.';
    throw new Error(
      `[dockerized-playwright] ${message} Start Docker Desktop, or set SJV_DOCKER=0 to bypass.`,
    );
  }
}

async function ensureImage(image: string): Promise<void> {
  try {
    await execFileAsync('docker', ['image', 'inspect', image]);
    return;
  } catch {
    // not present locally
  }
  console.log(`[dockerized-playwright] Pulling ${image} (one-time)...`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['pull', image], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker pull exited with code ${code}`));
    });
  });
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not allocate port')));
      }
    });
  });
}

async function startContainer(image: string, name: string, hostPort: number): Promise<void> {
  await execFileAsync('docker', ['rm', '-f', name]).catch(() => {});
  await execFileAsync('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--publish',
    `127.0.0.1:${hostPort}:${SERVER_PORT_IN_CONTAINER}`,
    '--init',
    image,
    'npx',
    '-y',
    'playwright',
    'run-server',
    '--host',
    '0.0.0.0',
    '--port',
    String(SERVER_PORT_IN_CONTAINER),
  ]);
}

async function waitForContainerLog(
  containerName: string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['logs', '-f', containerName], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buffered = '';
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(
        new Error(
          `[dockerized-playwright] Timed out waiting for container '${containerName}' to log ${pattern}. ` +
            `Last output:\n${buffered.slice(-1024)}`,
        ),
      );
    }, timeoutMs);
    const onChunk = (chunk: Buffer | string) => {
      buffered += chunk.toString();
      if (pattern.test(buffered)) finish();
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.once('error', (err) => finish(err));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`docker logs exited with code ${code} before pattern matched`));
    });
  });
}
