import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { JsonTestResults } from "vitest/node"
import { budgets } from "./bench-budgets.ts"

// Compares the benchmarks of a pull request with its base branch and with `bench-budgets.ts`, and
// writes the result as Markdown. Exits with 1 when a case regresses or goes over its budget.
//
// Usage: node scripts/bench-report.ts <directory>
//
// The directory holds `<name>.json` for the pull request and `<name>.base.json` for the base branch,
// for each name in `names`: the results of `vitest bench --reporter=json`.

const names = ["unit", "redis-store", "valkey-store", "bun-redis-store"]

// A change smaller than this, or inside the combined margin of error, is noise.
const tolerance = 0.1

type Result = { readonly mean: number; readonly moe: number }

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

// The results of one report, by group, algorithm and case, in microseconds.
function read(path: string) {
  const results = new Map<string, Map<string, Map<string, Result>>>()

  if (!existsSync(path)) {
    return results
  }

  const report = JSON.parse(readFileSync(path, "utf8")) as JsonTestResults

  for (const test of report.testResults.flatMap((file) => file.assertionResults)) {
    const group = test.ancestorTitles.join(" > ")
    const algorithms = results.get(group) ?? new Map<string, Map<string, Result>>()
    const cases = algorithms.get(test.title) ?? new Map<string, Result>()

    for (const task of test.benchmarks.flatMap((benchmark) => benchmark.tasks)) {
      cases.set(task.name, { mean: task.latency.mean * 1000, moe: task.latency.moe * 1000 })
    }

    algorithms.set(test.title, cases)
    results.set(group, algorithms)
  }

  return results
}

let regressions = 0
let overBudget = 0
let faster = 0
const lowerBudgets: string[] = []
const missing: string[] = []
const sections: string[] = []

for (const name of names) {
  const head = read(join(process.argv[2] ?? ".", `${name}.json`))
  const base = read(join(process.argv[2] ?? ".", `${name}.base.json`))

  if (head.size === 0) {
    missing.push(`\`${name}\``)
    continue
  }

  for (const [group, algorithms] of head) {
    const rows: string[] = []

    for (const [algorithm, cases] of algorithms) {
      for (const [caseName, result] of cases) {
        const before = base.get(group)?.get(algorithm)?.get(caseName)
        const budget = budgets[group]?.[algorithm]?.[caseName]
        const change = before ? result.mean / before.mean - 1 : undefined
        const percent = change === undefined ? undefined : Math.round(change * 100)
        const significant =
          before !== undefined
          && Math.abs(result.mean - before.mean) > Math.hypot(result.moe, before.moe)

        let status = "✅"

        if (budget === undefined) {
          status = "❔ no budget"
        } else if (result.mean > budget) {
          status = "❌ over budget"
          overBudget += 1
        } else if (change !== undefined && significant && change > tolerance) {
          status = "⚠️ regression"
          regressions += 1
        } else if (change !== undefined && significant && change < -tolerance) {
          status = "🚀 faster"
          faster += 1

          if (roundUp(result.mean * 2) < budget) {
            lowerBudgets.push(
              `| ${group} | ${algorithm} | ${caseName} | ${formatTime(budget)} | ${formatTime(roundUp(result.mean * 2))} |`
            )
          }
        }

        rows.push(
          [
            algorithm,
            caseName,
            before ? formatTime(before.mean) : "—",
            formatTime(result.mean),
            percent === undefined ? "—" : `${percent > 0 ? "+" : ""}${percent}%`,
            budget === undefined ? "—" : formatTime(budget),
            status,
          ].join(" | ")
        )
      }
    }

    sections.push(
      [
        `### ${group}`,
        "",
        "| Algorithm | Case | Base | PR | Change | Budget | Status |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
        ...rows.map((row) => `| ${row} |`),
      ].join("\n")
    )
  }
}

const passed = regressions === 0 && overBudget === 0
const summary = [
  passed ? "✅ No regressions" : `❌ ${regressions} regressions, ${overBudget} over budget`,
  `🚀 ${faster} faster`,
].join(" · ")

const output = [`**${summary}**`]

if (missing.length > 0) {
  output.push(
    `> [!WARNING]\n> No results for ${missing.join(", ")}. These jobs failed. See the workflow run.`
  )
}

output.push(
  `A case regresses when it is more than ${tolerance * 100}% slower than the base branch, by more than the combined margin of error. Base and PR ran on the same runner.`,
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
