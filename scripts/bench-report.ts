import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { JsonTestResults } from "vitest/node"
import { budgets } from "./bench-budgets.ts"

// Compares the benchmarks of a pull request with its base branch and with `bench-budgets.ts`, and
// writes the result as Markdown. Exits with 1 when a case regresses or goes over its budget.
//
// Usage: node scripts/bench-report.ts <directory>
//
// The directory holds the results of `vitest bench --reporter=json` for each store in `stores`:
// `<name>.<round>.json` for the pull request and `<name>.base.<round>.json` for the base branch.
// The rounds ran in turns on one runner: base, pull request, base, pull request, and so on.

// A store that uses the network moves by up to 80% between two runs on one runner, so only the
// stores that do not use the network can fail as a regression. All stores can fail on a budget.
const stores = [
  { gated: true, name: "unit" },
  { gated: false, name: "redis-store" },
  { gated: false, name: "valkey-store" },
  { gated: false, name: "bun-redis-store" },
]

// A change of the medians smaller than this is noise.
const tolerance = 0.1

const numberFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 2 })

// Vitest reports times in milliseconds. Budgets are in microseconds.
function formatTime(us: number) {
  return us < 1000 ? `${numberFormat.format(us)} µs` : `${numberFormat.format(us / 1000)} ms`
}

// Rounds up to two significant digits.
function roundUp(value: number) {
  const step = 10 ** (Math.floor(Math.log10(value)) - 1)
  return Math.ceil(value / step) * step
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

// The mean of each round, by group, algorithm and case, in microseconds.
function read(directory: string, pattern: RegExp) {
  const results = new Map<string, Map<string, Map<string, number[]>>>()
  const files = existsSync(directory) ? readdirSync(directory) : []

  for (const file of files.filter((name) => pattern.test(name))) {
    const report = JSON.parse(readFileSync(join(directory, file), "utf8")) as JsonTestResults

    for (const test of report.testResults.flatMap((result) => result.assertionResults)) {
      const group = test.ancestorTitles.join(" > ")
      const algorithms = results.get(group) ?? new Map<string, Map<string, number[]>>()
      const cases = algorithms.get(test.title) ?? new Map<string, number[]>()

      for (const task of test.benchmarks.flatMap((benchmark) => benchmark.tasks)) {
        cases.set(task.name, [...(cases.get(task.name) ?? []), task.latency.mean * 1000])
      }

      algorithms.set(test.title, cases)
      results.set(group, algorithms)
    }
  }

  return results
}

const directory = process.argv[2] ?? "."

let regressions = 0
let overBudget = 0
let faster = 0
const lowerBudgets: string[] = []
const missing: string[] = []
const sections: string[] = []

for (const { gated, name } of stores) {
  const head = read(directory, new RegExp(`^${name}\\.\\d+\\.json$`))
  const base = read(directory, new RegExp(`^${name}\\.base\\.\\d+\\.json$`))

  if (head.size === 0) {
    missing.push(`\`${name}\``)
    continue
  }

  for (const [group, algorithms] of head) {
    const rows: string[] = []

    for (const [algorithm, cases] of algorithms) {
      for (const [caseName, rounds] of cases) {
        const before = base.get(group)?.get(algorithm)?.get(caseName)
        const budget = budgets[group]?.[algorithm]?.[caseName]
        const after = median(rounds)
        const change = before ? after / median(before) - 1 : undefined
        const percent = change === undefined ? undefined : Math.round(change * 100)
        // Every pull request round is slower, or faster, than every base round.
        const slower = before !== undefined && Math.min(...rounds) > Math.max(...before)
        const quicker = before !== undefined && Math.max(...rounds) < Math.min(...before)

        // A case can have several statuses. The base comparison does not need a budget.
        const statuses: string[] = []

        if (budget !== undefined && after > budget) {
          statuses.push("❌ over budget")
          overBudget += 1
        }

        if (gated && change !== undefined && slower && change > tolerance) {
          statuses.push("⚠️ regression")
          regressions += 1
        }

        if (gated && change !== undefined && quicker && change < -tolerance) {
          statuses.push("🚀 faster")
          faster += 1

          if (budget !== undefined && roundUp(after * 2) < budget) {
            lowerBudgets.push(
              `| ${group} | ${algorithm} | ${caseName} | ${formatTime(budget)} | ${formatTime(roundUp(after * 2))} |`
            )
          }
        }

        if (budget === undefined) {
          statuses.push("❔ no budget")
        }

        rows.push(
          [
            algorithm,
            caseName,
            before ? formatTime(median(before)) : "—",
            formatTime(after),
            percent === undefined ? "—" : `${percent > 0 ? "+" : ""}${percent}%`,
            budget === undefined ? "—" : formatTime(budget),
            statuses.join(", ") || "✅",
          ].join(" | ")
        )
      }
    }

    sections.push(
      [
        `### ${group}`,
        "",
        ...(gated
          ? []
          : ["The change is for information only. This store checks only its budgets.", ""]),
        "| Algorithm | Case | Base | PR | Change | Budget | Status |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
        ...rows.map((row) => `| ${row} |`),
      ].join("\n")
    )
  }
}

// A store without results fails the check, because nothing shows that it did not regress. A base
// branch without results is valid: it has no benchmarks yet.
const problems = [
  regressions > 0 && `${regressions} regressions`,
  overBudget > 0 && `${overBudget} over budget`,
  missing.length > 0 && `${missing.length} without results`,
].filter((problem) => problem !== false)
const passed = problems.length === 0
const summary = `${passed ? "✅ No regressions" : `❌ ${problems.join(", ")}`} · 🚀 ${faster} faster`

const output = [`**${summary}**`]

if (missing.length > 0) {
  output.push(
    `> [!WARNING]\n> No results for ${missing.join(", ")}. Their jobs failed, or their results did not download. See the workflow run.`
  )
}

output.push(
  `Base and PR ran in turns on the same runner, and the table shows the median of the rounds. A case regresses when its median is more than ${tolerance * 100}% slower than the base branch, and every PR round is slower than every base round. Only the memory store and the limiter can regress. The network stores move too much between runs, so they check only their budgets.`,
  ...sections
)

if (lowerBudgets.length > 0) {
  output.push(
    [
      "<details><summary>Budgets you can lower in <code>scripts/bench-budgets.ts</code></summary>",
      "",
      "| Group | Algorithm | Case | Budget | Proposed |",
      "| --- | --- | --- | ---: | ---: |",
      ...lowerBudgets,
      "",
      "</details>",
    ].join("\n")
  )
}

process.stdout.write(`${output.join("\n\n")}\n`)
process.exitCode = passed ? 0 : 1
