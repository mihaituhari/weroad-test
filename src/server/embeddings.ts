import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { config } from './config.ts';
import type { Faq, Trip } from '../shared/types.ts';

// Local sentence embeddings (all-MiniLM-L6-v2, 384 dims, ~1ms per query on CPU).
// No extra API key, no network at query time. The model is downloaded once (baked into the Docker image).
env.cacheDir = config.modelCacheDir;

let extractor: Promise<FeatureExtractionPipeline> | null = null;
const load = () => (extractor ??= pipeline('feature-extraction', config.embeddingModel, { dtype: 'q8' }));

// Small batches keep memory flat: attention memory grows with batch size × text length², and 50 long trip
// texts at once needed over 1 GB (the container limit on Railway).
const BATCH = 8;

export async function embed(texts: string[]): Promise<number[][]> {
  const extract = await load();
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const output = await extract(texts.slice(i, i + BATCH), { pooling: 'mean', normalize: true });
    vectors.push(...(output.tolist() as number[][]));
  }
  return vectors;
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
