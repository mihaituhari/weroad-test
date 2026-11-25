import type { SearchState } from './types.ts';

/**
 * Demo scripts for "Try an example" on the search page. Each one starts from a classic
 * search (`start`) and plays the assistant `turns` in order, like a real visitor would.
 */
export interface Example {
  label: string;
  shows: string; // what this example demonstrates
  start: SearchState;
  turns: string[];
}

export const EXAMPLES: Example[] = [
  {
    label: 'Asia in winter, then a cooking class',
    shows: 'Multi-turn refinement of a classic search',
    start: { continents: ['Asia'] },
    turns: ['something warm between December and February', 'only trips with a cooking class', 'max 1800 euros'],
  },
  {
    label: 'I only have 19–24 October',
    shows: 'Tight date window: exact fit or the closest departures',
    start: { text: 'weekend city break' },
    turns: ['I only have 19-24 October'],
  },
  {
    label: 'Northern lights under €1,000',
    shows: 'Zero exact results → closest options with what differs',
    start: { text: 'northern lights' },
    turns: ['my budget is 1000 euros max'],
  },
  {
    label: 'Party & beaches, I am 23',
    shows: 'Vague intent → moods + age band',
    start: {},
    turns: ['I want to party and chill on beaches, I am 23'],
  },
  {
    label: 'Women-only trip',
    shows: 'Honesty: a filter no departure satisfies today',
    start: {},
    turns: ['women only trip in Europe'],
  },
  {
    label: 'Japan, and are flights included?',
    shows: 'FAQ question answered from the help centre (RAG)',
    start: { destinations: ['Japan'] },
    turns: ['are flights included?', 'what plugs do they use there?'],
  },
  {
    label: 'Easy hike, 3 friends, confirmed',
    shows: 'Group size (seats left), physical effort, guaranteed departure',
    start: { text: 'hiking' },
    turns: ['nothing too hard, we are 3 friends', 'only confirmed departures please'],
  },
  {
    label: 'Antarctica with penguins',
    shows: 'A destination we do not sell: low confidence, honest alternatives',
    start: {},
    turns: ['Antarctica to see penguins'],
  },
  {
    label: 'Sushi and temples',
    shows: 'No exact keyword in the catalog: semantic search does the work',
    start: { text: 'sushi and temples' },
    turns: [],
  },
];
