import { readFileSync } from "node:fs"
import type { JsonTestResults } from "vitest/node"

// Writes the results of `vitest bench --reporter=json` as Markdown, one table for each store.
// Usage: node scripts/bench-report.ts <report.json>...

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

// Vitest reports times in milliseconds.
function formatTime(ms: number) {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(1)} µs`
  }

  return `${ms.toFixed(2)} ms`
}

const sections = process.argv.slice(2).flatMap((path) => {
  const report = JSON.parse(readFileSync(path, "utf8")) as JsonTestResults
  const groups = Map.groupBy(
    report.testResults.flatMap((file) => file.assertionResults),
    (test) => test.ancestorTitles.join(" > ")
  )

  return [...groups].map(([group, tests]) => {
    const rows = tests.flatMap((test) =>
      test.benchmarks.flatMap((benchmark) =>
        benchmark.tasks.map(
          (task) =>
            `| ${test.title} | ${task.name} | ${formatTime(task.latency.mean)} | ${formatTime(task.latency.p99)} | ${numberFormat.format(task.throughput.mean)} | ±${task.latency.rme.toFixed(2)}% |`
        )
      )
    )

    return [
      `### ${group}`,
      "",
      "| Algorithm | Case | Mean | p99 | Ops/s | RME |",
      "| --- | --- | ---: | ---: | ---: | ---: |",
      ...rows,
    ].join("\n")
  })
})

process.stdout.write(`${sections.join("\n\n")}\n`)
