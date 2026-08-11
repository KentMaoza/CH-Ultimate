const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const RELEASE_NOTES = 'docs/releases/pilot-0.2.6.md';
const RELEASE_ASSETS = [
  'release/CH-Ultimate-0.2.6-Setup.exe',
  'release/CHU-Companion-Mobile-0.2.6-release.apk',
  'release/SHA256SUMS.txt',
];

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function defaultRunGh(args) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh ${args[0]} failed.`);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  return result.stdout;
}

function stagePilotDraft({
  runGh = defaultRunGh,
  repository,
  commitSha,
  releaseTag,
  fileExists = existsSync,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) {
    throw new Error('GITHUB_REPOSITORY is invalid.');
  }
  if (!/^[0-9a-f]{40}$/i.test(commitSha || '')) {
    throw new Error('GITHUB_SHA is invalid.');
  }
  const releaseMatch = /^pilot-v0\.2\.6-r([2-9]|[1-9][0-9])$/.exec(releaseTag || '');
  if (!releaseMatch) throw new Error('CHU_PILOT_RELEASE_TAG is invalid.');
  const candidateNumber = Number(releaseMatch[1]);
  const releaseTitle = `CH Ultimate pilot v0.2.6 r${releaseMatch[1]}`;
  for (const path of [...RELEASE_ASSETS, RELEASE_NOTES]) {
    if (!fileExists(path)) throw new Error(`Required release file is missing: ${path}`);
  }

  const releasePages = parseJson(runGh([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repository}/releases?per_page=100`,
  ]), 'Release lookup');
  if (!Array.isArray(releasePages) || releasePages.some((page) => !Array.isArray(page))) {
    throw new Error('Release lookup returned an invalid page envelope.');
  }
  const releases = releasePages.flat();
  const matchingReleases = releases.filter((release) => release?.tag_name === releaseTag);

  const tagRefs = parseJson(runGh([
    'api',
    `repos/${repository}/git/matching-refs/tags/${releaseTag}`,
  ]), 'Git tag lookup');
  if (!Array.isArray(tagRefs)) throw new Error('Git tag lookup returned an invalid envelope.');
  const exactRefs = tagRefs.filter((ref) => ref?.ref === `refs/tags/${releaseTag}`);

  if (matchingReleases.length > 0) {
    throw new Error(`Release ${releaseTag} already exists.`);
  }
  if (exactRefs.length > 0) throw new Error(`Tag ${releaseTag} already exists.`);
  if (candidateNumber > 2) {
    const previousTag = `pilot-v0.2.6-r${candidateNumber - 1}`;
    const previous = releases.filter((release) => release?.tag_name === previousTag);
    const previousAssetsValid = Array.isArray(previous[0]?.assets) &&
      previous[0].assets.every((asset) =>
        typeof asset?.name === 'string' && asset.name.length > 0 &&
        typeof asset?.size === 'number' && Number.isSafeInteger(asset.size) && asset.size >= 0,
      );
    const previousAssets = previousAssetsValid ? previous[0].assets : [];
    const complete = RELEASE_ASSETS.every((path) => {
      const name = path.slice(path.lastIndexOf('/') + 1);
      return previousAssets.some((asset) => asset?.name === name && asset?.size > 0);
    });
    const previousTarget = typeof previous[0]?.target_commitish === 'string' &&
      /^[0-9a-f]{40}$/i.test(previous[0].target_commitish)
      ? previous[0].target_commitish.toLowerCase()
      : null;
    const normalizedCommitSha = commitSha.toLowerCase();
    const recoversIncompleteCandidate = previousTarget === normalizedCommitSha && !complete;
    const supersedesCompleteCandidate = previousTarget !== null &&
      previousTarget !== normalizedCommitSha && complete;
    if (
      previous.length !== 1 ||
      previous[0]?.draft !== true ||
      previous[0]?.prerelease !== true ||
      !previousAssetsValid ||
      (!recoversIncompleteCandidate && !supersedesCompleteCandidate)
    ) {
      throw new Error(`Previous candidate ${previousTag} is not an eligible predecessor draft.`);
    }
  }

  runGh([
    'release',
    'create',
    releaseTag,
    ...RELEASE_ASSETS,
    '--repo',
    repository,
    '--draft',
    '--prerelease',
    '--target',
    commitSha,
    '--title',
    releaseTitle,
    '--notes-file',
    RELEASE_NOTES,
  ]);
}

module.exports = { stagePilotDraft };

if (require.main === module) {
  try {
    stagePilotDraft({
      repository: process.env.GITHUB_REPOSITORY,
      commitSha: process.env.GITHUB_SHA,
      releaseTag: process.env.CHU_PILOT_RELEASE_TAG,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
