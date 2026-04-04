/* ──────────────────────────────────────────────────────────────────
   Knowledge Base — loads and indexes help manifests for search
   ────────────────────────────────────────────────────────────────── */

import fs from 'fs';
import path from 'path';

export interface HelpManifest {
  feature: string;
  title: string;
  roles: string[];
  pages: string[];
  category: string;
  related?: string[];
  since: string;
  keywords?: string[];
  body: string;           // raw markdown body (after frontmatter)
  sections: Record<string, string>;  // parsed sections: { "What is this?": "...", "How to use it": "..." }
}

// ── Singleton cache ──
let _manifests: HelpManifest[] | null = null;

/**
 * Load all .help.md files from src/help/ directory.
 * Cached in memory after first load (server restarts clear cache).
 */
export function loadKnowledgeBase(): HelpManifest[] {
  if (_manifests) return _manifests;

  const helpDir = path.join(process.cwd(), 'src', 'help');
  const manifests: HelpManifest[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.help.md')) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const manifest = parseManifest(content);
          if (manifest) manifests.push(manifest);
        } catch (err) {
          console.error(`Failed to parse help manifest: ${full}`, err);
        }
      }
    }
  }

  walk(helpDir);
  _manifests = manifests;
  console.log(`[HelpEngine] Loaded ${manifests.length} help manifests`);
  return manifests;
}

/**
 * Force reload (for development / testing).
 */
export function reloadKnowledgeBase(): HelpManifest[] {
  _manifests = null;
  return loadKnowledgeBase();
}

/**
 * Parse a .help.md file into a HelpManifest.
 */
function parseManifest(content: string): HelpManifest | null {
  // Extract YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const yaml = fmMatch[1];
  const body = fmMatch[2].trim();

  // Simple YAML parser (no dependency needed for our flat schema)
  const meta = parseSimpleYaml(yaml);
  if (!meta.feature || !meta.title) return null;

  // Parse body into sections
  const sections: Record<string, string> = {};
  const sectionRegex = /^## (.+)$/gm;
  let match: RegExpExecArray | null;
  const sectionStarts: Array<{ heading: string; index: number }> = [];

  while ((match = sectionRegex.exec(body)) !== null) {
    sectionStarts.push({ heading: match[1].trim(), index: match.index + match[0].length });
  }

  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i].index;
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index - sectionStarts[i + 1].heading.length - 4 : body.length;
    sections[sectionStarts[i].heading] = body.slice(start, end).trim();
  }

  return {
    feature: meta.feature,
    title: meta.title,
    roles: parseYamlArray(meta.roles),
    pages: parseYamlArray(meta.pages),
    category: meta.category || 'general',
    related: meta.related ? parseYamlArray(meta.related) : undefined,
    since: meta.since || '',
    keywords: meta.keywords ? parseYamlArray(meta.keywords) : undefined,
    body,
    sections,
  };
}

/**
 * Simple YAML key-value parser. Handles strings and arrays.
 */
function parseSimpleYaml(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }
  return result;
}

/**
 * Parse YAML-style array: [a, b, c] → ['a', 'b', 'c']
 */
function parseYamlArray(raw: string): string[] {
  if (!raw) return [];
  const trimmed = raw.replace(/^\[/, '').replace(/\]$/, '');
  return trimmed.split(',').map(s => s.trim()).filter(Boolean);
}

// ── Search ──

export interface SearchResult {
  manifest: HelpManifest;
  score: number;
}

/**
 * Search the knowledge base for manifests relevant to a question + context.
 * Returns top-K results sorted by relevance score.
 */
export function searchKnowledgeBase(
  question: string,
  context: { role?: string; page?: string },
  topK: number = 3
): SearchResult[] {
  const manifests = loadKnowledgeBase();
  const queryTerms = tokenize(question);

  const scored: SearchResult[] = manifests
    .filter(m => {
      // Role filter: if we know the user's role, only show relevant manifests
      if (context.role && m.roles.length > 0) {
        if (!m.roles.includes(context.role) && !m.roles.includes('all')) {
          return false;
        }
      }
      return true;
    })
    .map(m => {
      let score = 0;

      // Page match bonus (highest weight — user is on this page)
      if (context.page) {
        for (const p of m.pages) {
          if (p === context.page || context.page.startsWith(p.replace('*', '')) || p === '/') {
            score += 10;
            break;
          }
        }
      }

      // Title match (2x weight)
      const titleTerms = tokenize(m.title);
      for (const qt of queryTerms) {
        if (titleTerms.some(tt => tt.includes(qt) || qt.includes(tt))) {
          score += 4;
        }
      }

      // Keyword match (2x weight)
      if (m.keywords) {
        const kwTerms = m.keywords.map(k => k.toLowerCase());
        for (const qt of queryTerms) {
          if (kwTerms.some(k => k.includes(qt) || qt.includes(k))) {
            score += 4;
          }
        }
      }

      // Body text match (1x weight)
      const bodyLower = m.body.toLowerCase();
      for (const qt of queryTerms) {
        if (qt.length >= 3 && bodyLower.includes(qt)) {
          score += 1;
        }
      }

      // Feature name match
      if (queryTerms.some(qt => m.feature.includes(qt))) {
        score += 3;
      }

      return { manifest: m, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

/**
 * Tokenize a string into lowercase terms, removing stop words.
 */
function tokenize(text: string): string[] {
  const stops = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'could', 'should',
    'can', 'may', 'might', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from',
    'by', 'about', 'into', 'through', 'and', 'or', 'but', 'not', 'so', 'if',
    'this', 'that', 'it', 'its', 'my', 'your', 'our', 'their', 'what', 'which',
    'who', 'how', 'when', 'where', 'why', 'i', 'me', 'we', 'you', 'he', 'she',
    'they', 'them', 'him', 'her', 'us']);

  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !stops.has(t));
}
