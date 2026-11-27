// Client-side search and filters for the registry page. The two pure functions are
// exported for tests; everything touching the DOM runs only in a browser.
import MiniSearch from 'minisearch';
import { heading, optionLabel, ownerOf } from '../registry/display.ts';

export interface Filters {
  s?: string;
  language?: string;
  tier?: string;
  kind?: string;
}

const OLD_FLAGS: Record<string, string> = { native: 'native', first_party: 'first-party' };

/** Reads the query string. `component` from the old registry is ignored; old `flag` values map onto tiers. */
export function readParams(search: string): Filters {
  const p = new URLSearchParams(search);
  const get = (k: string) => {
    const v = p.get(k)?.trim();
    return v && v !== 'all' ? v : undefined;
  };
  const tier = get('tier') ?? OLD_FLAGS[get('flag') ?? ''];
  const out: Filters = { s: get('s'), language: get('language'), tier, kind: get('kind') };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

export function matches(entry: { language?: string; kind: string; tiers: string[] }, f: Filters): boolean {
  return (!f.language || entry.language === f.language) && (!f.kind || entry.kind === f.kind) && (!f.tier || entry.tiers.includes(f.tier));
}

function init() {
  const list = document.getElementById('registry-list')!;
  const cards = [...list.querySelectorAll<HTMLElement>('.registry-entry')];
  const input = document.getElementById('input-s') as HTMLInputElement;
  const count = document.getElementById('result-count')!;
  const empty = document.getElementById('no-results')!;
  const filters = readParams(location.search);
  let index: MiniSearch | undefined;

  const labelFor = (key: 'language' | 'tier' | 'kind') => {
    const button = document.getElementById(`${key}Dropdown`)!;
    const item = filters[key] ? document.querySelector<HTMLElement>(`#${key}Filter [data-value="${CSS.escape(filters[key]!)}"]`) : null;
    button.textContent = item?.textContent?.trim() || button.dataset.label!;
  };

  async function ranked(query: string): Promise<string[]> {
    if (!index) {
      const entries: any[] = await (await fetch(list.dataset.source!)).json();
      index = new MiniSearch({
        fields: ['heading', 'target', 'language', 'labels', 'owners'],
        searchOptions: { prefix: true, fuzzy: 0.2, boost: { heading: 4, target: 2, labels: 2 }, combineWith: 'AND' },
      });
      index.addAll(
        // The registry has no ids; a card and its entry share a position.
        entries.map((e, i) => ({
          id: i,
          heading: heading(e),
          target: e.target.replace(/^https?:\/\//, ''),
          language: e.language ?? 'application',
          labels: e.options.map((o: any) => optionLabel(o)).join(' '),
          owners: e.options.map((o: any) => ownerOf(o.repo) ?? '').join(' '),
        })),
      );
    }
    return index.search(query).map((r) => String(r.id));
  }

  async function apply() {
    const order = filters.s ? await ranked(filters.s) : null;
    const rank = order ? new Map(order.map((id, i) => [id, i])) : null;
    let shown = 0;
    for (const card of cards) {
      const visible =
        matches({ language: card.dataset.language || undefined, kind: card.dataset.kind!, tiers: card.dataset.tiers!.split(' ') }, filters) &&
        (!rank || rank.has(card.dataset.index!));
      card.classList.toggle('d-none', !visible);
      if (visible) shown++;
    }
    // Best match first while searching, alphabetical otherwise.
    const sorted = rank ? [...cards].sort((a, b) => (rank.get(a.dataset.index!) ?? Infinity) - (rank.get(b.dataset.index!) ?? Infinity)) : cards;
    list.append(...sorted);
    count.textContent = `${shown} of ${cards.length} entries`;
    empty.classList.toggle('d-none', shown > 0);

    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    history.replaceState(null, '', params.size ? `?${params}` : location.pathname);
  }

  for (const key of ['language', 'tier', 'kind'] as const) {
    labelFor(key);
    document.getElementById(`${key}Filter`)!.addEventListener('click', (ev) => {
      const item = (ev.target as HTMLElement).closest<HTMLElement>('[data-value]');
      if (!item) return;
      ev.preventDefault();
      filters[key] = item.dataset.value === 'all' ? undefined : item.dataset.value;
      labelFor(key);
      apply();
    });
  }

  let timer: number | undefined;
  input.value = filters.s ?? '';
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      filters.s = input.value.trim() || undefined;
      apply();
    }, 150);
  });
  document.getElementById('searchForm')!.addEventListener('submit', (ev) => {
    ev.preventDefault();
    filters.s = input.value.trim() || undefined;
    apply();
  });
  document.getElementById('reset')!.addEventListener('click', () => {
    input.value = '';
    for (const k of ['s', 'language', 'tier', 'kind'] as const) filters[k] = undefined;
    for (const key of ['language', 'tier', 'kind'] as const) labelFor(key);
    apply();
  });

  apply();
}

if (typeof document !== 'undefined') init();
