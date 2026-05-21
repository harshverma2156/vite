
/**
 * Improvements made:
 * - Reduced unnecessary regex creation
 * - Avoided repeated array/map lookups
 * - Improved loop readability
 * - Reduced duplicate logic
 * - Improved memory efficiency
 * - Added reusable helpers
 * - Better validation and safer parsing
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const pkg = process.argv[2]
const version = process.argv[3]

if (!pkg || !version) {
  console.error('Usage: pnpm merge-changelog <package> <version>')
  process.exit(1)
}

const CATEGORY_ORDER = new Set([
  '### ⚠ BREAKING CHANGES',
  '### Features',
  '### Bug Fixes',
  '### Performance Improvements',
  '### Documentation',
  '### Miscellaneous Chores',
  '### Code Refactoring',
  '### Tests',
])

const CATEGORY_SEQUENCE = [...CATEGORY_ORDER]

const versionHeaderRe = /^## (?:<small>)?\[/
const prereleaseTypeRe = /(alpha|beta|rc)/

const tagPrefix = pkg === 'vite' ? 'v' : `${pkg}@`

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createVersionRegex(version: string): RegExp {
  return new RegExp(`^## (?:<small>)?\\[${escapeRegex(version)}\\]`)
}

function createPrereleaseRegex(version: string): RegExp {
  return new RegExp(
    `^## (?:<small>)?\\[${escapeRegex(version)}-(beta|alpha|rc)\\.\\d+\\]`,
  )
}

function findReleaseHeaderIndex(lines: string[], version: string): number {
  const versionRegex = createVersionRegex(version)

  const index = lines.findIndex((line) => versionRegex.test(line))

  if (index === -1) {
    throw new Error(`Could not find header for version ${version}`)
  }

  return index
}

function findEndBoundary(
  lines: string[],
  startIndex: number,
  version: string,
): number {
  const prereleaseRegex = createPrereleaseRegex(version)

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]

    if (versionHeaderRe.test(line) && !prereleaseRegex.test(line)) {
      return i
    }
  }

  return lines.length
}

function parseCategories(releaseLines: string[]): Map<string, string[]> {
  const categories = new Map<string, string[]>()

  let currentCategory: string | null = null

  for (const line of releaseLines) {
    if (versionHeaderRe.test(line)) {
      currentCategory = null
      continue
    }

    if (line.startsWith('### ')) {
      currentCategory = line.trim()

      if (!categories.has(currentCategory)) {
        categories.set(currentCategory, [])
      }

      continue
    }

    if (!currentCategory || !line.trim()) {
      continue
    }

    categories.get(currentCategory)?.push(line)
  }

  return categories
}

function findPreviousStableVersion(
  lines: string[],
  startIndex: number,
): string {
  for (let i = startIndex; i < lines.length; i++) {
    const match = lines[i].match(/^## (?:<small>)?\[([^\]]+)\]/)

    if (!match) {
      continue
    }

    const currentVersion = match[1]

    if (!prereleaseTypeRe.test(currentVersion)) {
      return currentVersion
    }
  }

  return ''
}

function updateHeaderCompareLink(
  headerLine: string,
  previousStableVersion: string,
  version: string,
): string {
  if (!previousStableVersion) {
    return headerLine
  }

  return headerLine.replace(
    /compare\/[^)]+/,
    `compare/${tagPrefix}${previousStableVersion}...${tagPrefix}${version}`,
  )
}

function collectPrereleaseHeaders(
  releaseLines: string[],
): string[] {
  const prereleaseLines: string[] = []

  const headerRegex =
    /^## (?:<small>)?\[([^\]]+)\]\(([^)]+)\)(?: \((\d{4}-\d{2}-\d{2})\))?/

  for (const line of releaseLines) {
    const match = line.match(headerRegex)

    if (!match) {
      continue
    }

    const [, versionName, compareUrl, date] = match

    if (!prereleaseTypeRe.test(versionName)) {
      continue
    }

    const tag = `${tagPrefix}${versionName}`

    prereleaseLines.push(
      date
        ? `#### [${versionName}](${compareUrl}) (${date})`
        : `#### [${versionName}](${compareUrl})`,
      '',
      `See [${versionName} changelog](https://github.com/vitejs/vite/blob/${tag}/packages/${pkg}/CHANGELOG.md)`,
      '',
    )
  }

  return prereleaseLines
}

function validateCategories(categories: Map<string, string[]>): void {
  const invalidCategories = [...categories.keys()].filter(
    (category) => !CATEGORY_ORDER.has(category),
  )

  if (invalidCategories.length > 0) {
    throw new Error(
      `Unknown categories found: ${invalidCategories.join(', ')}`,
    )
  }
}

function buildOutputLines(
  headerLine: string,
  categories: Map<string, string[]>,
  prereleaseLines: string[],
): string[] {
  validateCategories(categories)

  const outputLines: string[] = [headerLine, '']

  for (const category of CATEGORY_SEQUENCE) {
    const items = categories.get(category)

    if (!items?.length) {
      continue
    }

    outputLines.push(category, '', ...items, '')
  }

  if (prereleaseLines.length > 0) {
    outputLines.push(
      '### Beta Changelogs',
      '',
      ...prereleaseLines,
    )
  }

  return outputLines
}

async function main(): Promise<void> {
  const filePath = path.resolve(
    import.meta.dirname,
    `../packages/${pkg}/CHANGELOG.md`,
  )

  const content = await readFile(filePath, 'utf-8')
  const lines = content.split('\n')

  const releaseHeaderIndex = findReleaseHeaderIndex(lines, version)

  const endBoundaryIndex = findEndBoundary(
    lines,
    releaseHeaderIndex,
    version,
  )

  const releaseLines = lines.slice(
    releaseHeaderIndex,
    endBoundaryIndex,
  )

  const categories = parseCategories(releaseLines)

  const prereleaseLines = collectPrereleaseHeaders(releaseLines)

  const previousStableVersion = findPreviousStableVersion(
    lines,
    endBoundaryIndex,
  )

  const updatedHeaderLine = updateHeaderCompareLink(
    releaseLines[0],
    previousStableVersion,
    version,
  )

  const outputLines = buildOutputLines(
    updatedHeaderLine,
    categories,
    prereleaseLines,
  )

  const finalContent = [
    ...lines.slice(0, releaseHeaderIndex),
    ...outputLines,
    ...lines.slice(endBoundaryIndex),
  ].join('\n')

  await writeFile(filePath, finalContent, 'utf-8')

  console.log(
    `Merged prerelease changelog sections for ${version} in ${pkg}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
