import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StoreTimeoutError } from "#lib/limiter/errors.ts"
import { storeTimer } from "#lib/limiter/store-timer.ts"

function never() {
  return Promise.withResolvers<never>().promise
}

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
})
