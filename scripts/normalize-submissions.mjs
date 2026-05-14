#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const LANGUAGE_BY_EXTENSION = {
  '.c': 'C',
  '.cpp': 'C++',
  '.cs': 'C#',
  '.go': 'Go',
  '.java': 'Java',
  '.js': 'JavaScript',
  '.kt': 'Kotlin',
  '.py': 'Python',
  '.rs': 'Rust',
  '.sql': 'SQL',
  '.swift': 'Swift',
  '.ts': 'TypeScript'
};

const DEFAULT_TIME_ZONE = 'Asia/Seoul';
const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';

const args = parseArgs(process.argv.slice(2));
const sourceRoot = path.resolve(args.source ?? process.cwd());
const outputRoot = path.resolve(args.output ?? path.join(process.cwd(), 'normalized'));
const mapPath = path.resolve(args.map ?? path.join(sourceRoot, 'scripts', 'problem-map.json'));
const timeZone = args.timezone ?? DEFAULT_TIME_ZONE;
const offline = Boolean(args.offline);
const dryRun = Boolean(args['dry-run']);

const problemMap = await loadProblemMap(mapPath);
const sourceFiles = await collectFiles(sourceRoot);
const candidates = sourceFiles
  .map((file) => toSubmissionCandidate(sourceRoot, file))
  .filter(Boolean);

if (candidates.length === 0) {
  console.log('No NeetCode or LeetCode submission files found.');
  process.exit(0);
}

const resolvedEntries = [];
for (const candidate of candidates) {
  const metadata = await resolveMetadata(candidate, problemMap, { offline });
  const submittedAt = getSubmittedAt(sourceRoot, candidate.relativePath);
  resolvedEntries.push({ candidate, metadata, submittedAt });
}

const latestByProblem = chooseLatestByProblem(resolvedEntries);

for (const entry of latestByProblem) {
  const target = getTargetPaths(outputRoot, entry);
  const code = await fs.readFile(entry.candidate.absolutePath, 'utf8');
  const readme = renderReadme(entry, target.solutionFileName, timeZone);
  const meta = renderMeta(entry, target.solutionFileName);

  if (dryRun) {
    console.log(`[dry-run] ${entry.candidate.relativePath} -> ${path.relative(outputRoot, target.problemDir)}`);
    continue;
  }

  await fs.mkdir(target.problemDir, { recursive: true });
  await fs.writeFile(target.solutionPath, code);
  await fs.writeFile(path.join(target.problemDir, 'README.md'), readme);
  await fs.writeFile(path.join(target.problemDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
}

console.log(`Normalized ${latestByProblem.length} problem(s) into ${outputRoot}`);

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

async function loadProblemMap(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function collectFiles(rootDir) {
  const result = [];

  async function walk(currentDir) {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (dirent.name === '.git' || dirent.name === 'node_modules') {
        continue;
      }

      const absolutePath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(absolutePath);
      } else if (dirent.isFile()) {
        result.push(absolutePath);
      }
    }
  }

  await walk(rootDir);
  return result;
}

function toSubmissionCandidate(rootDir, absolutePath) {
  const extension = path.extname(absolutePath);
  if (!LANGUAGE_BY_EXTENSION[extension]) {
    return null;
  }

  const relativePath = toPosixPath(path.relative(rootDir, absolutePath));
  const parts = relativePath.split('/');
  const fileName = parts.at(-1);
  const submissionMatch = fileName.match(/^submission-(\d+)\.[^.]+$/);

  if (parts[0] === 'Only in LeetCode' && parts.length >= 3) {
    const folderName = parts[1];
    const parsedFolder = parseLeetCodeFolder(folderName);
    return {
      absolutePath,
      relativePath,
      sourcePlatform: 'LeetCode',
      sourceCategory: 'Only in LeetCode',
      sourceSlug: parsedFolder.slug,
      sourceId: parsedFolder.id,
      submissionIndex: null,
      extension,
      language: LANGUAGE_BY_EXTENSION[extension]
    };
  }

  if (submissionMatch && parts.length >= 3) {
    const problemFolder = parts.at(-2);
    return {
      absolutePath,
      relativePath,
      sourcePlatform: 'NeetCode',
      sourceCategory: parts.slice(0, -2).join('/'),
      sourceSlug: problemFolder,
      sourceId: null,
      submissionIndex: Number(submissionMatch[1]),
      extension,
      language: LANGUAGE_BY_EXTENSION[extension]
    };
  }

  return null;
}

function parseLeetCodeFolder(folderName) {
  const match = folderName.match(/^0*(\d+)[-_](.+)$/);
  if (!match) {
    return { id: null, slug: folderName };
  }

  return { id: match[1], slug: match[2] };
}

async function resolveMetadata(candidate, problemMap, options) {
  const mapped = problemMap[candidate.sourceSlug] ?? {};
  const leetcodeSlug = mapped.leetcodeSlug ?? candidate.sourceSlug;
  let remote = null;

  if (!options.offline) {
    remote = await fetchLeetCodeMetadata(leetcodeSlug);
  }

  const titleSlug = remote?.titleSlug ?? mapped.leetcodeSlug ?? leetcodeSlug;
  const id = remote?.questionFrontendId ?? mapped.id ?? candidate.sourceId ?? null;

  return {
    platform: 'LeetCode',
    sourcePlatform: candidate.sourcePlatform,
    sourceCategory: candidate.sourceCategory,
    sourcePath: candidate.relativePath,
    id,
    title: remote?.title ?? mapped.title ?? titleFromSlug(titleSlug),
    titleSlug,
    difficulty: remote?.difficulty ?? mapped.difficulty ?? 'Unknown',
    topics: remote?.topicTags?.map((tag) => tag.name) ?? mapped.topics ?? [],
    url: `https://leetcode.com/problems/${titleSlug}/`,
    language: candidate.language
  };
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
        'User-Agent': 'algostudy-normalizer'
      },
      body: JSON.stringify({ query, variables: { titleSlug } })
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return payload.data?.question ?? null;
  } catch {
    return null;
  }
}

function chooseLatestByProblem(entries) {
  const latest = new Map();

  for (const entry of entries) {
    const key = entry.metadata.titleSlug;
    const previous = latest.get(key);
    if (!previous || compareEntries(entry, previous) > 0) {
      latest.set(key, entry);
    }
  }

  return [...latest.values()].sort((a, b) => {
    const aId = Number(a.metadata.id ?? Number.MAX_SAFE_INTEGER);
    const bId = Number(b.metadata.id ?? Number.MAX_SAFE_INTEGER);
    if (aId !== bId) {
      return aId - bId;
    }

    return a.metadata.title.localeCompare(b.metadata.title);
  });
}

function compareEntries(a, b) {
  if (a.submittedAt && b.submittedAt && a.submittedAt !== b.submittedAt) {
    return a.submittedAt > b.submittedAt ? 1 : -1;
  }

  const aIndex = a.candidate.submissionIndex ?? -1;
  const bIndex = b.candidate.submissionIndex ?? -1;
  if (aIndex !== bIndex) {
    return aIndex - bIndex;
  }

  return a.candidate.relativePath.localeCompare(b.candidate.relativePath);
}

function getSubmittedAt(rootDir, relativePath) {
  try {
    const output = execFileSync(
      'git',
      ['-C', rootDir, 'log', '-1', '--format=%cI', '--', relativePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return output || null;
  } catch {
    return null;
  }
}

function getTargetPaths(rootDir, entry) {
  const idPrefix = entry.metadata.id ? String(entry.metadata.id).padStart(4, '0') : '0000';
  const difficulty = sanitizePathSegment(entry.metadata.difficulty || 'Unknown');
  const title = sanitizePathSegment(entry.metadata.title);
  const folderName = `${idPrefix}. ${title}`;
  const problemDir = path.join(rootDir, 'LeetCode', difficulty, folderName);
  const solutionFileName = `solution${entry.candidate.extension}`;

  return {
    problemDir,
    solutionFileName,
    solutionPath: path.join(problemDir, solutionFileName)
  };
}

function renderReadme(entry, solutionFileName, timeZone) {
  const { metadata, submittedAt } = entry;
  const difficultyLabel = metadata.difficulty === 'Unknown' ? 'LeetCode' : metadata.difficulty;
  const problemId = metadata.id ?? '-';
  const topicText = metadata.topics.length > 0 ? metadata.topics.join(', ') : '수집되지 않음';
  const submittedText = submittedAt ? formatKoreanDate(submittedAt, timeZone) : '수집되지 않음';

  return `# [${difficultyLabel}] ${metadata.title} - ${problemId}

[문제 링크](${metadata.url})

### 성능 요약

런타임: 수집되지 않음, 메모리: 수집되지 않음

### 분류

${topicText}

### 제출 일자

${submittedText}

### 출처

- 플랫폼: ${metadata.sourcePlatform}
- 원본 경로: \`${metadata.sourcePath}\`
- 언어: ${metadata.language}

### 문제 요약

문제 원문은 저작권 및 약관 리스크를 피하기 위해 저장하지 않습니다. 이 문서는 LeetCode의 공개 메타데이터와 제출 코드 위치를 기준으로 생성합니다.

### 풀이 파일

- [${solutionFileName}](./${solutionFileName})
`;
}

function renderMeta(entry, solutionFileName) {
  const { metadata, submittedAt } = entry;
  return {
    platform: metadata.platform,
    sourcePlatform: metadata.sourcePlatform,
    sourceCategory: metadata.sourceCategory,
    sourcePath: metadata.sourcePath,
    id: metadata.id,
    title: metadata.title,
    slug: metadata.titleSlug,
    difficulty: metadata.difficulty,
    topics: metadata.topics,
    url: metadata.url,
    language: metadata.language,
    solutionFile: solutionFileName,
    submittedAt,
    generatedAt: new Date().toISOString()
  };
}

function formatKoreanDate(isoDate, timeZone) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
    .formatToParts(new Date(isoDate))
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.hour}:${parts.minute}:${parts.second}`;
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function sanitizePathSegment(segment) {
  return String(segment)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}
