/* ──────────────────────────────────────────────────────────────────
   Help Responder — generates answers using Qwen + template fallback
   ────────────────────────────────────────────────────────────────── */

import llm, { MODEL_PRIMARY } from '@/lib/llm';
import { searchKnowledgeBase, type SearchResult } from './knowledge-base';

export interface HelpResponse {
  answer: string;
  source: 'ai' | 'template' | 'no-match';
  matched_features: string[];
  metadata: {
    question: string;
    role?: string;
    page?: string;
    search_results: number;
  };
}

/**
 * Answer a help question using Qwen + knowledge base context.
 * Falls back to template (direct KB excerpt) if Qwen is unavailable.
 */
export async function answerHelpQuestion(
  question: string,
  context: { role?: string; page?: string; department?: string }
): Promise<HelpResponse> {
  // 1. Search the knowledge base
  const results = searchKnowledgeBase(question, {
    role: context.role,
    page: context.page,
  });

  const metadata = {
    question,
    role: context.role,
    page: context.page,
    search_results: results.length,
  };

  // 2. No matches — generic response
  if (results.length === 0) {
    return {
      answer: "I don't have specific help content for that question yet. Try rephrasing, or type **/help** to see what topics I can help with. You can also ask your department head or the GM for guidance.",
      source: 'no-match',
      matched_features: [],
      metadata,
    };
  }

  const matchedFeatures = results.map(r => r.manifest.feature);

  // 3. Try Qwen for a conversational answer
  try {
    const aiAnswer = await generateAIAnswer(question, results, context);
    if (aiAnswer) {
      return {
        answer: aiAnswer,
        source: 'ai',
        matched_features: matchedFeatures,
        metadata,
      };
    }
  } catch (err) {
    console.error('[HelpEngine] Qwen error, falling back to template:', err);
  }

  // 4. Fallback: show the best-matching KB section directly
  const templateAnswer = generateTemplateAnswer(question, results);
  return {
    answer: templateAnswer,
    source: 'template',
    matched_features: matchedFeatures,
    metadata,
  };
}

/**
 * Generate an AI-powered answer using Qwen with KB context.
 */
async function generateAIAnswer(
  question: string,
  results: SearchResult[],
  context: { role?: string; page?: string; department?: string }
): Promise<string | null> {
  // Build context from top KB matches
  const docContext = results.map((r, i) => {
    const sections = Object.entries(r.manifest.sections)
      .map(([heading, content]) => `### ${heading}\n${content}`)
      .join('\n\n');
    return `<doc title="${r.manifest.title}" feature="${r.manifest.feature}">\n${sections}\n</doc>`;
  }).join('\n\n');

  const roleNote = context.role ? `The user's role is: ${context.role}.` : '';
  const pageNote = context.page ? `They are currently on page: ${context.page}.` : '';

  const systemPrompt = `You are the help assistant for EHRC Rounds, Even Hospital's operations app.
Answer the user's question based ONLY on the documentation provided below.
If the documentation doesn't cover their question, say so honestly — do not make up information.
Keep answers concise (under 150 words). Use numbered steps for how-to questions.
Be friendly and use simple language — many users are not tech-savvy.
${roleNote} ${pageNote}

DOCUMENTATION:
${docContext}`;

  const response = await llm.chat.completions.create({
    model: MODEL_PRIMARY,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ],
    temperature: 0.2,
    max_tokens: 300,
  });

  const content = response.choices[0]?.message?.content;
  return content && content.trim().length > 10 ? content.trim() : null;
}

/**
 * Template fallback: extract the most relevant section from the best match.
 */
function generateTemplateAnswer(question: string, results: SearchResult[]): string {
  const best = results[0].manifest;
  const questionLower = question.toLowerCase();

  // Try to match a specific section based on question intent
  if (questionLower.includes('how') || questionLower.includes('step') || questionLower.includes('use')) {
    if (best.sections['How to use it']) {
      return `**${best.title}**\n\n${best.sections['How to use it']}`;
    }
  }

  if (questionLower.includes('problem') || questionLower.includes('error') || questionLower.includes('not working') || questionLower.includes("can't") || questionLower.includes('broken')) {
    if (best.sections['Troubleshooting']) {
      return `**${best.title} — Troubleshooting**\n\n${best.sections['Troubleshooting']}`;
    }
  }

  if (questionLower.includes('what') && (questionLower.includes('is') || questionLower.includes('does') || questionLower.includes('mean'))) {
    if (best.sections['What is this?']) {
      return `**${best.title}**\n\n${best.sections['What is this?']}`;
    }
  }

  // Default: show the FAQ section or the full body
  if (best.sections['Common questions']) {
    return `**${best.title} — FAQ**\n\n${best.sections['Common questions']}`;
  }

  // Last resort: first 500 chars of body
  return `**${best.title}**\n\n${best.body.slice(0, 500)}...`;
}

/**
 * Detect if a text input looks like a help question (vs a normal message/reply).
 */
export function isHelpQuestion(text: string): boolean {
  const trimmed = text.trim().toLowerCase();

  // Explicit help triggers
  if (trimmed === 'help' || trimmed === '/help') return true;
  if (trimmed.startsWith('help ') || trimmed.startsWith('help:')) return true;

  // Question patterns
  const questionPatterns = [
    /^how (do|can|does|to|should|would)/,
    /^what (is|are|does|do|should|can|happens)/,
    /^where (is|are|do|can|should)/,
    /^why (is|are|does|do|can|should|won't|isn't|doesn't|don't)/,
    /^can (i|you|we|someone)/,
    /^i (don't|can't|cannot|couldn't|don't) (understand|know|find|see|figure)/,
    /^i('m| am) (stuck|confused|lost|not sure)/,
    /^(show|tell|explain|teach) me/,
    /\?$/,  // ends with question mark
  ];

  return questionPatterns.some(p => p.test(trimmed));
}

/**
 * Get a list of all available help topics (for /help command).
 */
export function getHelpTopics(): Array<{ feature: string; title: string; category: string }> {
  const { loadKnowledgeBase } = require('./knowledge-base');
  const manifests = loadKnowledgeBase();
  return manifests.map((m: { feature: string; title: string; category: string }) => ({
    feature: m.feature,
    title: m.title,
    category: m.category,
  }));
}
