const MAX_TEXT = 1000;
const MAX_ITEMS = 8;

function knownText(facts, key) {
  return typeof facts[key] === 'string' ? facts[key].trim() : null;
}

function labelledItems(items, label, available) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, available)
    .map((item) => `${label}${item.trim().slice(0, MAX_TEXT - label.length)}`);
}

// The observed summary is assembled only from the collector's original fields.
// Model output can add explicitly labelled proposals, never observed facts.
export function assembleStationReport(facts, modelReport) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new TypeError('Rapporten behöver originalobservationer.');
  }
  const title = knownText(facts, 'title');
  const description = knownText(facts, 'description');
  const lang = knownText(facts, 'lang');
  const observations = [
    title === null
      ? 'Uppgift om sidtitel saknas i underlaget.'
      : title
        ? `Sidtitel finns i hämtad HTML: ”${title.slice(0, 500)}”.`
        : 'Sidtitel saknas i hämtad HTML.',
    description === null
      ? 'Uppgift om metabeskrivning saknas i underlaget.'
      : description
        ? 'Metabeskrivning finns i hämtad HTML.'
        : 'Metabeskrivning saknas i hämtad HTML.',
    typeof facts.hasViewport !== 'boolean'
      ? 'Uppgift om viewport-tagg saknas i underlaget.'
      : facts.hasViewport
        ? 'Viewport-tagg finns i hämtad HTML.'
        : 'Viewport-information saknas eller är tom i hämtad HTML.',
    lang === null
      ? 'Uppgift om språkmarkering saknas i underlaget.'
      : lang
        ? `Språkmarkering finns i hämtad HTML: ”${lang.slice(0, 40)}”.`
        : 'Språkmarkering saknas i hämtad HTML.',
    'Observationerna gäller en HTML-sida utan JavaScript-rendering.',
  ];
  const suggestions = [];
  if (title === '') {
    suggestions.push(
      'Lägg till en tydlig sidtitel för den hämtade sidan; title saknas i dess HTML.',
    );
  }
  if (description === '') {
    suggestions.push(
      'Lägg till en relevant metabeskrivning för den hämtade sidan; meta description saknas i dess HTML.',
    );
  }
  if (facts.hasViewport === false) {
    suggestions.push(
      'Kontrollera mobilanpassningen och komplettera vid behov viewport-informationen för den hämtade sidan; den saknas eller har tomt innehåll i HTML. Det visar inte i sig att mobilvisningen är trasig.',
    );
  }
  if (lang === '') {
    suggestions.push(
      'Ange sidans språk med lang på html-elementet; språkmarkeringen saknas i den hämtade HTML-sidan.',
    );
  }
  suggestions.push(
    ...labelledItems(
      modelReport?.suggestions,
      'AI-förslag att granska: ',
      MAX_ITEMS - suggestions.length,
    ),
  );
  const unknowns = [
    'Endast en HTML-sida är observerad. JavaScript-rendering, mobilutseende, användbarhet och prestanda är inte verifierade.',
    'Företagsidentitet, domänrelation och Göteborgstillhörighet är inte verifierade av denna HTML-observation.',
  ];
  unknowns.push(
    ...labelledItems(
      modelReport?.unknowns,
      'AI-osäkerhet att granska: ',
      MAX_ITEMS - unknowns.length,
    ),
  );
  return {
    summary: observations.join(' ').slice(0, 4000),
    suggestions,
    unknowns,
  };
}
