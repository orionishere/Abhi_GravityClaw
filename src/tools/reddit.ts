import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const REDDIT_DIR = path.join(config.dataPath, 'reddit');
const STYLE_PROFILE_FILE = path.join(config.dataPath, 'writing_style.json');

// ============================
// CSV PARSER (simple — handles quoted fields)
// ============================
function parseCSV(filePath: string): Record<string, string>[] {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const rows: Record<string, string>[] = [];

    let currentLine = '';
    for (let i = 1; i < lines.length; i++) {
        currentLine += (currentLine ? '\n' : '') + lines[i];
        // Check if we have balanced quotes (complete row)
        const quoteCount = (currentLine.match(/"/g) || []).length;
        if (quoteCount % 2 === 0) {
            const values = parseCSVLine(currentLine);
            if (values.length >= headers.length - 1) {
                const row: Record<string, string> = {};
                headers.forEach((h, idx) => row[h] = (values[idx] || '').trim());
                rows.push(row);
            }
            currentLine = '';
        }
    }
    return rows;
}

function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

// ============================
// TOOL SCHEMAS
// ============================

export const redditAnalyzeStyleSchema = {
    type: 'function',
    function: {
        name: 'reddit_analyze_style',
        description: 'Analyze the user\'s Reddit post and comment history to build a detailed writing style profile. Returns a comprehensive style analysis including tone, vocabulary, sentence patterns, favorite topics, and personality traits. This profile is saved and automatically used by the twitter_draft_thread tool.',
        parameters: {
            type: 'object',
            properties: {
                maxSamples: {
                    type: 'number',
                    description: 'Maximum number of posts+comments to analyze (default: 200). More = more accurate but slower.'
                },
                subredditFilter: {
                    type: 'string',
                    description: 'Optional: Only analyze posts from this subreddit (e.g. "Cricket")'
                }
            },
            additionalProperties: false
        }
    }
};

export const redditGetStyleProfileSchema = {
    type: 'function',
    function: {
        name: 'reddit_get_style_profile',
        description: 'Retrieve the user\'s saved writing style profile (previously generated from Reddit data). Used by the agent to draft content that matches the user\'s natural voice.',
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    }
};

export const redditBrowsePostsSchema = {
    type: 'function',
    function: {
        name: 'reddit_browse_posts',
        description: 'Browse the user\'s Reddit post and comment history. Returns the actual text content for review or analysis.',
        parameters: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['posts', 'comments', 'both'],
                    description: 'What to browse: posts only, comments only, or both (default: both)'
                },
                count: {
                    type: 'number',
                    description: 'Number of items to return (default: 20)'
                },
                subredditFilter: {
                    type: 'string',
                    description: 'Optional: Filter by subreddit name'
                }
            },
            additionalProperties: false
        }
    }
};

// ============================
// TOOL EXECUTORS
// ============================

export async function redditAnalyzeStyle(args: any): Promise<string> {
    const maxSamples = args.maxSamples || 200;
    const subredditFilter = args.subredditFilter?.toLowerCase();

    // Load comments and posts
    let comments = parseCSV(path.join(REDDIT_DIR, 'comments.csv'));
    let posts = parseCSV(path.join(REDDIT_DIR, 'posts.csv'));

    if (comments.length === 0 && posts.length === 0) {
        return 'No Reddit data found. Make sure data/reddit/ contains comments.csv and posts.csv from the Reddit data export.';
    }

    if (subredditFilter) {
        comments = comments.filter(c => c.subreddit?.toLowerCase() === subredditFilter);
        posts = posts.filter(p => p.subreddit?.toLowerCase() === subredditFilter);
    }

    // Combine and sort by date (newest first)
    const allContent = [
        ...comments.filter(c => c.body?.trim()).map(c => ({
            type: 'comment' as const,
            text: c.body.trim(),
            subreddit: c.subreddit,
            date: c.date,
        })),
        ...posts.filter(p => (p.body?.trim() || p.title?.trim())).map(p => ({
            type: 'post' as const,
            text: (p.body?.trim() ? `${p.title}\n\n${p.body}` : p.title).trim(),
            subreddit: p.subreddit,
            date: p.date,
        }))
    ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, maxSamples);

    if (allContent.length === 0) {
        return 'No content found with the given filters.';
    }

    // ============================
    // ANALYSIS
    // ============================
    const allTexts = allContent.map(c => c.text);

    // Word stats
    const allWords = allTexts.join(' ').split(/\s+/);
    const totalWords = allWords.length;
    const avgWordsPerPost = Math.round(totalWords / allContent.length);

    // Sentence length
    const sentences = allTexts.join(' ').split(/[.!?]+/).filter(s => s.trim().length > 5);
    const avgWordsPerSentence = Math.round(sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / Math.max(sentences.length, 1));

    // Subreddit distribution
    const subredditCounts: Record<string, number> = {};
    allContent.forEach(c => { subredditCounts[c.subreddit] = (subredditCounts[c.subreddit] || 0) + 1; });
    const topSubreddits = Object.entries(subredditCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Vocabulary richness (unique words / total words)
    const uniqueWords = new Set(allWords.map(w => w.toLowerCase().replace(/[^a-z']/g, '')).filter(w => w.length > 2));
    const vocabularyRichness = (uniqueWords.size / Math.max(totalWords, 1) * 100).toFixed(1);

    // Common phrases (2-grams)
    const bigrams: Record<string, number> = {};
    const lowerWords = allWords.map(w => w.toLowerCase().replace(/[^a-z']/g, '')).filter(w => w.length > 2);
    for (let i = 0; i < lowerWords.length - 1; i++) {
        const pair = `${lowerWords[i]} ${lowerWords[i + 1]}`;
        bigrams[pair] = (bigrams[pair] || 0) + 1;
    }
    const commonPhrases = Object.entries(bigrams)
        .filter(([_, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([phrase, count]) => `"${phrase}" (${count}x)`);

    // Punctuation style
    const exclamations = (allTexts.join(' ').match(/!/g) || []).length;
    const questions = (allTexts.join(' ').match(/\?/g) || []).length;
    const ellipses = (allTexts.join(' ').match(/\.\.\./g) || []).length;
    const emojis = (allTexts.join(' ').match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu) || []).length;

    // Tone indicators
    const uppercaseWords = allWords.filter(w => w === w.toUpperCase() && w.length > 2 && /[A-Z]/.test(w)).length;
    const haha = (allTexts.join(' ').match(/\b(haha|hehe|lol|lmao|rofl)\b/gi) || []).length;

    // Sample posts (for the LLM to reference)
    const bestSamples = allContent
        .filter(c => c.text.length > 50 && c.text.length < 500)
        .slice(0, 20)
        .map(c => c.text);

    // Build profile
    const profile = {
        updatedAt: new Date().toISOString(),
        sampleCount: allContent.length,
        totalWords,
        stats: {
            avgWordsPerPost,
            avgWordsPerSentence,
            vocabularyRichness: `${vocabularyRichness}%`,
            punctuation: {
                exclamationsPerPost: (exclamations / allContent.length).toFixed(2),
                questionsPerPost: (questions / allContent.length).toFixed(2),
                usesEllipses: ellipses > 3,
                usesEmojis: emojis > 3,
                usesAllCaps: uppercaseWords > 10,
                usesLaughter: haha > 3,
            }
        },
        topSubreddits: topSubreddits.map(([name, count]) => `r/${name} (${count})`),
        commonPhrases,
        sampleWritings: bestSamples,
    };

    // Save to disk
    fs.writeFileSync(STYLE_PROFILE_FILE, JSON.stringify(profile, null, 2));

    // Build readable output
    let output = `## 📝 Writing Style Analysis\n\n`;
    output += `**Analyzed:** ${allContent.length} posts/comments (${totalWords.toLocaleString()} total words)\n\n`;

    output += `### ✍️ Writing Patterns\n`;
    output += `- **Avg length:** ${avgWordsPerPost} words per post\n`;
    output += `- **Sentence length:** ~${avgWordsPerSentence} words per sentence\n`;
    output += `- **Vocabulary richness:** ${vocabularyRichness}% unique words\n`;
    output += `- **Exclamation style:** ${exclamations > allContent.length * 0.5 ? 'Frequent !' : 'Moderate'}\n`;
    output += `- **Uses questions:** ${questions > allContent.length * 0.3 ? 'Often' : 'Sometimes'}\n`;
    output += `- **Ellipses (...):** ${ellipses > 3 ? 'Yes' : 'Rarely'}\n`;
    output += `- **ALL CAPS emphasis:** ${uppercaseWords > 10 ? 'Yes' : 'Rarely'}\n`;
    output += `- **Laughter (haha/lol):** ${haha > 3 ? 'Yes, casual tone' : 'Rare'}\n\n`;

    output += `### 🏠 Top Subreddits\n`;
    topSubreddits.forEach(([name, count]) => { output += `- r/${name} — ${count} posts\n`; });

    output += `\n### 🔤 Common Phrases\n`;
    commonPhrases.forEach(p => { output += `- ${p}\n`; });

    output += `\n✅ Style profile saved to disk. It will be automatically used when drafting Twitter threads.`;
    return output;
}

export async function redditGetStyleProfile(_args: any): Promise<string> {
    if (!fs.existsSync(STYLE_PROFILE_FILE)) {
        return 'No style profile found. Run reddit_analyze_style first to generate one from your Reddit data.';
    }
    const profile = JSON.parse(fs.readFileSync(STYLE_PROFILE_FILE, 'utf8'));
    return JSON.stringify(profile, null, 2);
}

export async function redditBrowsePosts(args: any): Promise<string> {
    const type = args.type || 'both';
    const count = Math.min(args.count || 20, 50);
    const subredditFilter = args.subredditFilter?.toLowerCase();

    let items: Array<{ type: string; text: string; subreddit: string; date: string }> = [];

    if (type === 'posts' || type === 'both') {
        const posts = parseCSV(path.join(REDDIT_DIR, 'posts.csv'));
        items.push(...posts.filter(p => p.title?.trim() || p.body?.trim()).map(p => ({
            type: 'post',
            text: p.body?.trim() ? `${p.title}\n\n${p.body}` : p.title,
            subreddit: p.subreddit,
            date: p.date,
        })));
    }

    if (type === 'comments' || type === 'both') {
        const comments = parseCSV(path.join(REDDIT_DIR, 'comments.csv'));
        items.push(...comments.filter(c => c.body?.trim()).map(c => ({
            type: 'comment',
            text: c.body,
            subreddit: c.subreddit,
            date: c.date,
        })));
    }

    if (subredditFilter) {
        items = items.filter(i => i.subreddit?.toLowerCase() === subredditFilter);
    }

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    items = items.slice(0, count);

    if (items.length === 0) return 'No posts/comments found matching the criteria.';

    let output = `## 📖 Reddit History (${items.length} items)\n\n`;
    for (const item of items) {
        const date = new Date(item.date).toLocaleDateString();
        output += `**[${item.type}]** r/${item.subreddit} — ${date}\n`;
        output += `> ${item.text.substring(0, 300)}${item.text.length > 300 ? '...' : ''}\n\n`;
    }
    return output;
}
