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
const NEETCODE_PROBLEM_URL = 'https://neetcode.io/problems';
const TOPIC_IDEAS = {
  Array: '배열을 한 번 이상 순회하면서 필요한 상태를 누적한다.',
  'Hash Table': '해시 기반 조회로 이미 본 값이나 필요한 보완 값을 빠르게 찾는다.',
  String: '문자 단위의 순서, 빈도, 짝 관계를 명확히 관리한다.',
  Sorting: '정렬을 이용해 비교 기준을 단순화하거나 같은 그룹을 모은다.',
  Stack: '최근에 열린 상태를 스택에 저장하고 닫히는 조건과 매칭한다.',
  'Monotonic Stack': '단조 스택으로 다음에 조건을 만족하는 위치를 빠르게 찾는다.',
  'Depth-First Search': 'DFS로 연결된 상태를 깊게 따라가며 방문 여부를 관리한다.',
  'Breadth-First Search': 'BFS로 같은 거리의 상태를 차례대로 확장한다.',
  'Union Find': '서로 연결된 원소를 집합으로 묶어 컴포넌트를 관리한다.',
  Graph: '노드와 간선의 연결 관계를 기준으로 방문 가능한 영역을 탐색한다.',
  'Graph Theory': '노드와 간선의 연결 관계를 기준으로 방문 가능한 영역을 탐색한다.',
  Matrix: '행과 열의 경계 조건, 방문 처리, 방향 이동을 함께 관리한다.',
  'Dynamic Programming': '중복되는 부분 문제의 답을 저장해 더 큰 상태의 답을 만든다.',
  Simulation: '문제에서 요구하는 규칙을 순서대로 그대로 적용한다.'
};

const args = parseArgs(process.argv.slice(2));
const sourceRoot = path.resolve(args.source ?? process.cwd());
const outputRoot = path.resolve(args.output ?? path.join(process.cwd(), 'normalized'));
const mapPath = path.resolve(args.map ?? path.join(sourceRoot, 'scripts', 'problem-map.json'));
const templatePath = path.resolve(args.template ?? path.join(sourceRoot, 'scripts', 'templates', 'leetcode-readme.md'));
const timeZone = args.timezone ?? DEFAULT_TIME_ZONE;
const offline = Boolean(args.offline);
const dryRun = Boolean(args['dry-run']);

const problemMap = await loadProblemMap(mapPath);
const readmeTemplate = await loadReadmeTemplate(templatePath);
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

if (!dryRun) {
  await removeGeneratedMetaFiles(outputRoot);
}

for (const entry of latestByProblem) {
  const target = getTargetPaths(outputRoot, entry);
  const code = await fs.readFile(entry.candidate.absolutePath, 'utf8');
  const readme = renderReadme(entry, target.solutionFileName, timeZone, readmeTemplate);

  if (dryRun) {
    console.log(`[dry-run] ${entry.candidate.relativePath} -> ${path.relative(outputRoot, target.problemDir)}`);
    continue;
  }

  await fs.mkdir(target.problemDir, { recursive: true });
  await fs.writeFile(target.solutionPath, code);
  await fs.writeFile(path.join(target.problemDir, 'README.md'), readme);
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

async function loadReadmeTemplate(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`README template not found: ${filePath}`);
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

async function removeGeneratedMetaFiles(rootDir) {
  const leetcodeRoot = path.join(rootDir, 'LeetCode');

  try {
    const files = await collectFiles(leetcodeRoot);
    await Promise.all(
      files
        .filter((file) => path.basename(file) === 'meta.json')
        .map((file) => fs.unlink(file))
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
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
  let neetcodeDetails = null;

  if (!options.offline) {
    remote = await fetchLeetCodeMetadata(leetcodeSlug);
    if (candidate.sourcePlatform === 'NeetCode') {
      neetcodeDetails = await fetchNeetCodeDetails(candidate.sourceSlug);
    }
  }

  const titleSlug = remote?.titleSlug ?? mapped.leetcodeSlug ?? leetcodeSlug;
  const id = remote?.questionFrontendId ?? mapped.id ?? candidate.sourceId ?? null;
  const leetcodeDetails = remote?.content ? parseProblemDetails(remote.content) : null;
  const problemDetails = mergeProblemDetails(neetcodeDetails, leetcodeDetails, remote);

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
    language: candidate.language,
    problemDetails
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
        content
        exampleTestcases
        hints
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

async function fetchNeetCodeDetails(sourceSlug) {
  try {
    const response = await fetch(`${NEETCODE_PROBLEM_URL}/${sourceSlug}/question`, {
      headers: {
        'User-Agent': 'algostudy-normalizer'
      }
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const articleHtml = extractBetween(
      html,
      '<main class="my-article-component-container">',
      '</main>'
    );
    const detailsHtml = articleHtml || html;
    const details = parseProblemDetails(detailsHtml);
    const metaSummary = extractMetaDescription(html);

    return {
      ...details,
      summary: details.summary || metaSummary
    };
  } catch {
    return null;
  }
}

function mergeProblemDetails(primary, fallback, remote) {
  const normalizedPrimary = primary ?? {};
  const normalizedFallback = fallback ?? {};

  return {
    statement: normalizedPrimary.statement || normalizedFallback.statement || '',
    summary: normalizedPrimary.summary || normalizedFallback.summary || '',
    examples: pickNonEmptyArray(normalizedPrimary.examples, normalizedFallback.examples),
    constraints: pickNonEmptyArray(normalizedPrimary.constraints, normalizedFallback.constraints),
    hints: pickNonEmptyArray(normalizedPrimary.hints, remote?.hints ?? normalizedFallback.hints),
    timeComplexity: normalizedPrimary.timeComplexity || normalizedFallback.timeComplexity || null,
    spaceComplexity: normalizedPrimary.spaceComplexity || normalizedFallback.spaceComplexity || null,
    rawExampleTestcases: remote?.exampleTestcases ?? null
  };
}

function pickNonEmptyArray(...arrays) {
  for (const array of arrays) {
    if (Array.isArray(array) && array.length > 0) {
      return array;
    }
  }

  return [];
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

function renderReadme(entry, solutionFileName, timeZone, template) {
  const { metadata, submittedAt } = entry;
  const details = metadata.problemDetails ?? {};
  const difficultyLabel = metadata.difficulty === 'Unknown' ? 'LeetCode' : metadata.difficulty;
  const problemId = metadata.id ?? '-';
  const topicText = metadata.topics.length > 0 ? metadata.topics.join(', ') : '수집되지 않음';
  const submittedText = submittedAt ? formatKoreanDate(submittedAt, timeZone) : '수집되지 않음';
  const sample = details.examples?.[0] ?? null;
  const constraints = details.constraints?.slice(0, 5) ?? [];
  const coreIdeas = buildCoreIdeas(metadata);
  const implementationFlow = buildImplementationFlow(metadata);
  const cautions = buildCautions(metadata, constraints);
  const formula = buildFormula(metadata, details);
  const summary = buildProblemSummary(metadata, details);
  const problemStatement = details.statement || summary;
  const oneLine = buildOneLineSummary(metadata, details);
  const problemInfoTable = [
    '| 항목 | 내용 |',
    '| --- | --- |',
    `| 플랫폼 | ${metadata.sourcePlatform} |`,
    `| 문제 번호 | ${problemId} |`,
    `| 난이도 | ${difficultyLabel} |`,
    `| 분류 | ${topicText} |`,
    `| 언어 | ${metadata.language} |`,
    `| 제출 일자 | ${submittedText} |`,
    `| 문제 링크 | [${metadata.title}](${metadata.url}) |`,
    `| 원본 경로 | \`${metadata.sourcePath}\` |`
  ].join('\n');

  return renderTemplate(template, {
    TITLE: metadata.title,
    PROBLEM_INFO_TABLE: problemInfoTable,
    PROBLEM_STATEMENT: problemStatement,
    PROBLEM_SUMMARY: summary,
    INPUT_SECTION: renderInputSection(sample),
    OUTPUT_SECTION: renderOutputSection(sample),
    CORE_IDEAS: renderBullets(coreIdeas),
    FORMULA: formula,
    IMPLEMENTATION_FLOW: renderNumberedList(implementationFlow),
    CAUTIONS: renderBullets(cautions),
    SOLUTION_FILE_NAME: solutionFileName,
    SOURCE_PATH: metadata.sourcePath,
    TIME_COMPLEXITY: details.timeComplexity ?? '직접 분석 필요',
    SPACE_COMPLEXITY: details.spaceComplexity ?? '직접 분석 필요',
    ONE_LINE_SUMMARY: oneLine
  });
}

function renderTemplate(template, values) {
  const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!Object.hasOwn(values, key)) {
      throw new Error(`Missing README template value: ${key}`);
    }

    return values[key];
  });

  return `${rendered.trimEnd()}\n`;
}

function parseProblemDetails(html) {
  const statement = htmlToMarkdown(stripAuxiliarySections(html));
  const exampleBlocks = extractPreBlocks(html).map(parseExampleBlock).filter(Boolean);
  const constraints = extractConstraints(html);
  const summary = summarizeProblemHtml(html);
  const recommendedComplexity = extractRecommendedComplexity(html);
  const hints = extractHints(html);

  return {
    statement,
    summary,
    examples: exampleBlocks,
    constraints,
    hints,
    timeComplexity: recommendedComplexity.time,
    spaceComplexity: recommendedComplexity.space
  };
}

function summarizeProblemHtml(html) {
  const beforeExamples = html.split(/<strong[^>]*>\s*(?:Example|Examples|Constraints)\b/i)[0];
  const paragraphs = [...beforeExamples.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => htmlToText(match[1]))
    .filter(Boolean)
    .filter((text) => !/^&nbsp;$/.test(text));

  const summary = paragraphs.join(' ');
  return truncateText(summary, 320);
}

function extractPreBlocks(html) {
  return [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)]
    .map((match) => htmlToText(match[1]))
    .map((text) => text.replace(/\n{3,}/g, '\n\n').trim())
    .filter(Boolean);
}

function parseExampleBlock(block) {
  const normalized = block.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
  const input = extractLabeledText(normalized, 'Input', ['Output', 'Explanation']);
  const output = extractLabeledText(normalized, 'Output', ['Explanation']);
  const explanation = extractLabeledText(normalized, 'Explanation', []);

  if (!input && !output && !explanation) {
    return null;
  }

  return { input, output, explanation };
}

function extractLabeledText(text, label, nextLabels) {
  const escapedLabel = escapeRegExp(label);
  const nextPattern = nextLabels.length > 0
    ? `(?=\\n?\\s*(?:${nextLabels.map(escapeRegExp).join('|')})\\s*:|$)`
    : '$';
  const match = text.match(new RegExp(`${escapedLabel}\\s*:\\s*([\\s\\S]*?)${nextPattern}`, 'i'));

  return match?.[1]?.trim() ?? '';
}

function extractConstraints(html) {
  const constraintsMatch = html.match(/<strong[^>]*>\s*Constraints\s*:\s*<\/strong>[\s\S]*?<ul\b[^>]*>([\s\S]*?)<\/ul>/i)
    ?? html.match(/Constraints\s*:\s*<\/[^>]+>[\s\S]*?<ul\b[^>]*>([\s\S]*?)<\/ul>/i);

  if (!constraintsMatch) {
    return [];
  }

  return [...constraintsMatch[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => htmlToText(match[1]))
    .filter(Boolean);
}

function extractRecommendedComplexity(html) {
  const section = extractBetween(html, 'Recommended Time', '</details>') ?? '';
  const text = htmlToText(section);
  const match = text.match(/O\([^)]+\)\s*time\s+and\s+O\([^)]+\)\s*space/i);

  if (!match) {
    return { time: null, space: null };
  }

  const complexities = match[0].match(/O\([^)]+\)/g) ?? [];
  return {
    time: complexities[0] ?? null,
    space: complexities[1] ?? null
  };
}

function extractHints(html) {
  return [...html.matchAll(/<summary>\s*Hint\s+\d+\s*<\/summary>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => truncateText(htmlToText(match[1]), 220))
    .filter(Boolean);
}

function extractMetaDescription(html) {
  const match = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  return match ? truncateText(decodeHtml(match[1]), 280) : '';
}

function buildProblemSummary(metadata, details) {
  const lines = [];
  const summary = details.summary || `${metadata.title} 문제의 요구사항을 문제 링크 기준으로 요약합니다.`;
  lines.push(`- ${summary}`);

  if (details.constraints?.length > 0) {
    lines.push(`- 주요 제약: ${details.constraints.slice(0, 2).join(' / ')}`);
  }

  if (metadata.topics.length > 0) {
    lines.push(`- 핵심 분류: ${metadata.topics.slice(0, 4).join(', ')}`);
  }

  return lines.join('\n');
}

function buildCoreIdeas(metadata) {
  const topicIdeas = metadata.topics
    .map((topic) => TOPIC_IDEAS[topic])
    .filter(Boolean);

  if (topicIdeas.length > 0) {
    return unique(topicIdeas).slice(0, 4);
  }

  return [
    '입력 크기와 제약을 먼저 확인하고, 완전 탐색이 가능한지 판단한다.',
    '반복되는 상태나 빠른 조회가 필요한 값은 적절한 자료구조로 관리한다.'
  ];
}

function buildFormula(metadata, details) {
  const inferredCondition = extractConditionFromSummary(details.summary);
  if (inferredCondition) {
    return `요구 조건 \`${inferredCondition}\`을 만족하는 값을 계산합니다.`;
  }

  if (metadata.topics.includes('Dynamic Programming')) {
    return '`dp[state]`를 이전 상태에서 전이해 최적값을 갱신합니다.';
  }

  if (metadata.topics.some((topic) => ['Graph', 'Graph Theory', 'Tree', 'Depth-First Search', 'Breadth-First Search'].includes(topic))) {
    return '정답은 조건을 만족하는 노드/칸/컴포넌트를 탐색하며 누적합니다.';
  }

  if (metadata.topics.includes('Hash Table')) {
    return '현재 값과 이미 처리한 값 사이의 관계를 빠르게 조회해 정답 조건을 판별합니다.';
  }

  if (metadata.topics.includes('Sorting')) {
    return '정렬 후 인접하거나 같은 기준을 가진 원소들을 비교해 정답을 계산합니다.';
  }

  return '입력에서 요구 조건을 만족하는 값을 계산해 반환합니다.';
}

function extractConditionFromSummary(summary) {
  if (!summary) {
    return '';
  }

  const equality = summary.match(/[A-Za-z0-9_[\].()]+\s*(?:[+\-*/%]\s*[A-Za-z0-9_[\].()]+)?\s*(?:==|<=|>=|<|>)\s*[A-Za-z0-9_[\].()]+/);
  return equality?.[0] ?? '';
}

function buildImplementationFlow(metadata) {
  const flow = ['입력으로 주어진 값과 예외 케이스를 먼저 정리한다.'];

  if (metadata.topics.includes('Hash Table')) {
    flow.push('빠른 조회가 필요한 값을 해시맵 또는 해시셋에 저장한다.');
  } else if (metadata.topics.includes('Stack') || metadata.topics.includes('Monotonic Stack')) {
    flow.push('스택에 아직 처리되지 않은 후보를 유지하며 현재 값과 비교한다.');
  } else if (metadata.topics.includes('Breadth-First Search')) {
    flow.push('큐를 사용해 가까운 상태부터 방문하고, 방문 여부를 함께 관리한다.');
  } else if (metadata.topics.includes('Depth-First Search')) {
    flow.push('재귀 또는 스택으로 연결된 상태를 끝까지 탐색한다.');
  } else if (metadata.topics.includes('Dynamic Programming')) {
    flow.push('작은 상태의 답을 저장하고 더 큰 상태로 전이한다.');
  } else {
    flow.push('문제 조건에 맞는 자료구조를 선택해 순회한다.');
  }

  flow.push('정답 조건을 만족하면 결과를 갱신하거나 즉시 반환한다.');
  flow.push('모든 입력을 처리한 뒤 최종 결과를 반환한다.');
  return flow;
}

function buildCautions(metadata, constraints) {
  const cautions = [];

  if (constraints.length > 0) {
    cautions.push(`제약 조건: ${constraints.slice(0, 3).join(' / ')}`);
  }

  if (metadata.topics.includes('Hash Table')) {
    cautions.push('같은 값을 여러 번 사용할 수 있는지, 인덱스 중복이 허용되는지 확인한다.');
  }

  if (metadata.topics.includes('Stack')) {
    cautions.push('스택이 비어 있는 상태에서 top을 참조하지 않도록 처리한다.');
  }

  if (metadata.topics.some((topic) => ['Depth-First Search', 'Breadth-First Search', 'Graph', 'Matrix'].includes(topic))) {
    cautions.push('방문 처리 시점이 늦으면 중복 방문이나 무한 탐색이 생길 수 있다.');
  }

  if (metadata.topics.includes('Dynamic Programming')) {
    cautions.push('초기값과 불가능한 상태를 구분해 오답 전이를 막는다.');
  }

  if (cautions.length === 0) {
    cautions.push('입력의 경계값과 빈 값 처리 여부를 확인한다.');
  }

  return unique(cautions).slice(0, 5);
}

function buildOneLineSummary(metadata, details) {
  const topicText = metadata.topics.length > 0 ? metadata.topics.slice(0, 2).join(', ') : '조건 처리';
  const complexity = details.timeComplexity ? ` 목표 시간 복잡도는 ${details.timeComplexity}입니다.` : '';
  return `${metadata.title}은 ${topicText} 관점에서 핵심 조건을 빠르게 판별하는 문제입니다.${complexity}`;
}

function renderInputSection(sample) {
  if (!sample?.input) {
    return '함수 인자 또는 입력 형식은 문제 링크를 기준으로 확인합니다.';
  }

  return `\`\`\`text\n${sample.input}\n\`\`\``;
}

function renderOutputSection(sample) {
  if (!sample?.output) {
    return '반환값 또는 출력 형식은 문제 링크를 기준으로 확인합니다.';
  }

  const explanation = sample.explanation ? `\n\n설명: ${sample.explanation}` : '';
  return `\`\`\`text\n${sample.output}\n\`\`\`${explanation}`;
}

function renderBullets(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function renderNumberedList(items) {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function htmlToText(html) {
  return decodeHtml(
    html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function htmlToMarkdown(html) {
  const withCodeBlocks = html
    .replace(/<!---->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
      const code = htmlToText(inner);
      return `\n\n\`\`\`text\n${code}\n\`\`\`\n\n`;
    });

  const markdown = withCodeBlocks
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
      const headingLevel = Math.min(Number(level) + 2, 6);
      return `\n\n${'#'.repeat(headingLevel)} ${htmlInlineToMarkdown(inner)}\n\n`;
    })
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => `\n\n${htmlInlineToMarkdown(inner)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${htmlInlineToMarkdown(inner)}`)
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:div|main|section|article|span)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return decodeHtml(markdown);
}

function htmlInlineToMarkdown(html) {
  return decodeHtml(
    html
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => `\`${htmlToText(inner).replace(/\n+/g, ' ')}\``)
      .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, inner) => `**${htmlInlineToMarkdown(inner)}**`)
      .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, inner) => `*${htmlInlineToMarkdown(inner)}*`)
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
        const text = htmlInlineToMarkdown(inner);
        return text ? `[${text}](${decodeHtml(href)})` : decodeHtml(href);
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripAuxiliarySections(html) {
  return html
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '')
    .replace(/<div\b[^>]*class=["'][^"']*company-tags-container[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-');
}

function extractBetween(text, startToken, endToken) {
  const startIndex = text.indexOf(startToken);
  if (startIndex < 0) {
    return null;
  }

  const contentStart = startIndex + startToken.length;
  const endIndex = text.indexOf(endToken, contentStart);
  if (endIndex < 0) {
    return null;
  }

  return text.slice(contentStart, endIndex);
}

function truncateText(text, maxLength) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unique(items) {
  return [...new Set(items)];
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
