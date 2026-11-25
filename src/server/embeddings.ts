import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { config } from './config.ts';
import type { Faq, Trip } from '../shared/types.ts';

// Local sentence embeddings (all-MiniLM-L6-v2, 384 dims, ~1ms per query on CPU).
// No extra API key, no network at query time. The model is downloaded once (baked into the Docker image).
env.cacheDir = config.modelCacheDir;

let extractor: Promise<FeatureExtractionPipeline> | null = null;
const load = () => (extractor ??= pipeline('feature-extraction', config.embeddingModel, { dtype: 'q8' }));

export async function embed(texts: string[]): Promise<number[][]> {
  const output = await (await load())(texts, { pooling: 'mean', normalize: true });
  return output.tolist() as number[][];
}

export const embedOne = async (text: string) => (await embed([text]))[0];

export const tripText = (t: Trip) =>
  [
    t.title,
    `${t.destinationLabel}, ${t.destination}, ${t.continent}`,
    t.travelTypes.join(', '),
    t.shortDescription,
    t.description,
    t.itinerary.map((d) => [d.title, ...d.highlights].join(': ')).join('. '),
  ]
    .filter(Boolean)
    .join('\n');

export const faqText = (f: Faq) => `${f.title}\n${f.body}`;
