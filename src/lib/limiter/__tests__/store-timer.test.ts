import { setFlagsFromString } from "node:v8"
import { runInNewContext } from "node:vm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StoreTimeoutError } from "#lib/limiter/errors.ts"
import { storeTimer } from "#lib/limiter/store-timer.ts"

function never() {
  return Promise.withResolvers<never>().promise
}

setFlagsFromString("--expose-gc")
const gc = runInNewContext("gc") as () => void
// Taken before the fake timers replace it. A weak reference clears only after the current task.
const nextTask = globalThis.setImmediate

describe("storeTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("passes on the value and the error of a call that answers in time", async () => {
    const watch = storeTimer(100)

    await expect(watch(Promise.resolve("ok"))).resolves.toBe("ok")
    await expect(watch(Promise.reject(new Error("down")))).rejects.toThrow("down")
  })

  it("rejects a call that does not answer in time", async () => {
    const watch = storeTimer(100)
    const call = watch(never())
    const settled = vi.fn()
    call.catch(settled)

    await vi.advanceTimersByTimeAsync(99)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(call).rejects.toEqual(new StoreTimeoutError(100))
  })

  it("rejects each slow call at its own deadline, while other calls answer", async () => {
    const watch = storeTimer(100)
    const first = watch(never())
    first.catch(vi.fn())

    await vi.advanceTimersByTimeAsync(40)
    const fast = watch(Promise.resolve("fast"))
    const second = watch(never())
    const secondSettled = vi.fn()
    second.catch(secondSettled)

    await expect(fast).resolves.toBe("fast")

    await vi.advanceTimersByTimeAsync(60)
    await expect(first).rejects.toBeInstanceOf(StoreTimeoutError)
    expect(secondSettled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(40)
    await expect(second).rejects.toBeInstanceOf(StoreTimeoutError)
  })

  it("rejects a slow call that starts after every earlier call answered", async () => {
    const watch = storeTimer(100)
    await watch(Promise.resolve("ok"))

    await vi.advanceTimersByTimeAsync(50)
    const call = watch(never())
    const settled = vi.fn()
    call.catch(settled)

    await vi.advanceTimersByTimeAsync(99)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(call).rejects.toBeInstanceOf(StoreTimeoutError)
  })

  it("ignores an answer that comes after the timeout", async () => {
    const watch = storeTimer(100)
    const { promise, resolve } = Promise.withResolvers<string>()
    const call = watch(promise)
    call.catch(vi.fn())

    await vi.advanceTimersByTimeAsync(100)
    resolve("late")

    await expect(call).rejects.toBeInstanceOf(StoreTimeoutError)
  })

  it("measures the timeout on a clock that the system time does not move", async () => {
    const watch = storeTimer(50)
    const call = watch(never())
    const settled = vi.fn()
    call.catch(settled)

    await vi.advanceTimersByTimeAsync(10)
    vi.setSystemTime(Date.now() - 250)
    await vi.advanceTimersByTimeAsync(40)

    expect(settled).toHaveBeenCalledWith(new StoreTimeoutError(50))
  })

  it("lets answered calls go while a timed-out call is still pending", async () => {
    const watch = storeTimer(100)
    const stuck = never()
    watch(stuck).catch(vi.fn())

    await vi.advanceTimersByTimeAsync(50)
    let next = Promise.withResolvers<string>()
    let current = watch(next.promise)
    await vi.advanceTimersByTimeAsync(50)

    gc()
    const before = process.memoryUsage().heapUsed

    // One call is always pending, so the queue never empties while the calls answer.
    for (let index = 0; index < 50_000; index += 1) {
      const answer = next
      const call = current
      next = Promise.withResolvers<string>()
      current = watch(next.promise)
      answer.resolve("ok")
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each call answers before the next one starts.
      await call
    }
    next.resolve("ok")
    await current

    await new Promise((resolve) => {
      nextTask(resolve)
    })
    gc()

    // Each call that the stuck call kept would hold about 170 bytes, so 50,000 calls would hold about 8 MB.
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(1_000_000)
    // The stuck call stays pending until here.
    expect(stuck).toBeInstanceOf(Promise)
  })
})
