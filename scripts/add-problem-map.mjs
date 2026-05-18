#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';

const args = parseArgs(process.argv.slice(2));
const mapPath = path.resolve(args.map ?? path.join(process.cwd(), 'scripts', 'problem-map.json'));
const neetcodeSlug = parseProblemSlug(args.neetcode ?? args['neetcode-url'], 'neetcode');
const leetcodeSlug = parseProblemSlug(args.leetcode ?? args['leetcode-url'], 'leetcode');

if (!neetcodeSlug || !leetcodeSlug) {
  printUsage();
  process.exit(1);
}

const problemMap = await loadProblemMap(mapPath);
const existing = problemMap[neetcodeSlug];

if (existing?.leetcodeSlug && existing.leetcodeSlug !== leetcodeSlug && !args.force) {
  throw new Error(
    `${neetcodeSlug} is already mapped to ${existing.leetcodeSlug}. Re-run with --force to replace it.`
  );
}

const remote = args.offline ? null : await fetchLeetCodeMetadata(leetcodeSlug);
const topics = parseTopics(args.topics);
const entry = removeEmptyValues({
  leetcodeSlug,
  id: args.id ?? remote?.questionFrontendId,
  title: args.title ?? remote?.title,
  difficulty: args.difficulty ?? remote?.difficulty,
  topics: topics.length > 0 ? topics : remote?.topicTags?.map((tag) => tag.name)
});

problemMap[neetcodeSlug] = {
  ...(existing ?? {}),
  ...entry
};

await fs.writeFile(mapPath, stringifyProblemMap(problemMap));
console.log(`${neetcodeSlug} -> ${leetcodeSlug}`);
if (remote) {
  console.log(`Loaded LeetCode metadata: ${remote.questionFrontendId}. ${remote.title} (${remote.difficulty})`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

function parseProblemSlug(value, platform) {
  if (!value) {
    return '';
  }

  const raw = String(value).trim();
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const problemIndex = parts.indexOf('problems');
    if (problemIndex >= 0 && parts[problemIndex + 1]) {
      return parts[problemIndex + 1];
    }
  } catch {
    // Plain slugs are accepted.
  }

  return raw
    .replace(/^https?:\/\/[^/]+\/?/i, '')
    .replace(new RegExp(`^${platform}/`), '')
    .replace(/^problems\//, '')
    .split('/')
    .filter(Boolean)[0] ?? raw;
}

async function loadProblemMap(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function fetchLeetCodeMetadata(titleSlug) {
  const query = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionFrontendId
        title
        titleSlug
        difficulty
        topicTags {
          name
          slug
        }
      }
    }
  `;

  try {
    const response = await fetch(LEETCODE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: `https://leetcode.com/problems/${titleSlug}/`,
        'User-Agent': 'algostudy-problem-map'
      },
      body: JSON.stringify({ query, variables: { titleSlug } })
    });

    if (!response.ok) {
      console.warn(`LeetCode metadata fetch failed: HTTP ${response.status}`);
      return null;
    }

    const payload = await response.json();
    return payload.data?.question ?? null;
  } catch (error) {
    console.warn(`LeetCode metadata fetch failed: ${error.message}`);
    return null;
  }
}

function parseTopics(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((topic) => topic.trim())
    .filter(Boolean);
}

function removeEmptyValues(value) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => {
        if (Array.isArray(entryValue)) {
          return entryValue.length > 0;
        }

        return entryValue !== undefined && entryValue !== null && entryValue !== '';
      })
  );
}

function stringifyProblemMap(problemMap) {
  const lines = ['{'];
  const entries = Object.entries(problemMap);

  entries.forEach(([slug, entry], index) => {
    lines.push(`  ${JSON.stringify(slug)}: {`);

    const fields = [
      ['leetcodeSlug', entry.leetcodeSlug],
      ['id', entry.id],
      ['title', entry.title],
      ['difficulty', entry.difficulty],
      ['topics', entry.topics]
    ].filter(([, value]) => value !== undefined);

    fields.forEach(([key, value], fieldIndex) => {
      const comma = fieldIndex === fields.length - 1 ? '' : ',';
      if (Array.isArray(value)) {
        lines.push(`    ${JSON.stringify(key)}: [${value.map((item) => JSON.stringify(item)).join(', ')}]${comma}`);
      } else {
        lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
      }
    });

    lines.push(`  }${index === entries.length - 1 ? '' : ','}`);
  });

  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function printUsage() {
  console.error(`
Usage:
  node scripts/add-problem-map.mjs \\
    --neetcode-url https://neetcode.io/problems/search-for-word/question \\
    --leetcode-url https://leetcode.com/problems/word-search/description/

Options:
  --neetcode <slug>       NeetCode slug, for example search-for-word
  --leetcode <slug>       LeetCode slug, for example word-search
  --map <path>            problem-map.json path
  --offline               Do not fetch LeetCode metadata
  --id <id>               Override LeetCode problem id
  --title <title>         Override LeetCode problem title
  --difficulty <level>    Override difficulty
  --topics <a,b,c>        Override comma-separated topic list
  --force                 Replace an existing mapping that points elsewhere
`.trim());
}
