import { prepare, generate, type GenerateResult, type Prepared } from './core/pipeline';
import { createGenerator } from './core/providers';
import type { ProviderId, Quality, Style } from './core/types';

export * from './core/types';
export { prepare, generate } from './core/pipeline';
export type { Prepared, GenerateResult, GenerateSettings, PrepareOptions } from './core/pipeline';
export { createGenerator, ProviderError, SetupError, DEFAULT_MODELS, DEFAULT_SERVER_URL } from './core/providers';

export interface GenerateReadmeOptions {
  provider?: ProviderId;
  model?: string;
  quality?: Quality;
  style?: Style;
  sections?: string[];
  fresh?: boolean;
  badges?: boolean;
  toc?: boolean;
  linkCheck?: boolean;
  ignore?: string[];
  serverUrl?: string;
  signal?: AbortSignal;
  onText?: (chunk: string) => void;
}

/**
 * Generates a README for a project folder and returns it. Nothing is written to disk.
 *
 * @example
 * const { readme } = await generateReadme('.', { provider: 'claude' });
 */
export async function generateReadme(dir: string, opts: GenerateReadmeOptions = {}): Promise<GenerateResult & { prepared: Prepared }> {
  const provider = opts.provider ?? 'hosted';
  const quality = opts.quality ?? 'fast';
  const prepared = await prepare(dir, { provider, quality, fresh: opts.fresh, ignore: opts.ignore });
  const generator = createGenerator({ provider, quality, model: opts.model, serverUrl: opts.serverUrl });
  const result = await generate(
    prepared,
    generator,
    { style: opts.style ?? 'standard', quality, sections: opts.sections, badges: opts.badges, toc: opts.toc, linkCheck: opts.linkCheck },
    { onText: opts.onText },
    opts.signal,
  );
  return { ...result, prepared };
}
