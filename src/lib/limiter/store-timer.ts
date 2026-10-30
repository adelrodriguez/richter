import { StoreTimeoutError } from "./errors.ts"

type Pending = {
  readonly deadline: number
  readonly reject: (error: StoreTimeoutError) => void
  settled: boolean
  next: Pending | undefined
}

// Times out a limiter's store calls with one timer. Every call waits the same time, so deadlines
// come in the order the calls start, and the timer watches only the oldest call that is pending.
// The timer holds the process open only while a call is pending, like a timer for each call.
// Deadlines use `performance.now()`, so a change to the system time does not move them.
export function storeTimer(timeout: number) {
  let head: Pending | undefined
  let tail: Pending | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  // Removes the oldest call and its link to the next call. A store can keep a call that timed out
  // for a long time, and the link would keep every later call with it.
  function shift() {
    const first = head
    if (first === undefined) return

    head = first.next
    first.next = undefined
  }

  function expire() {
    const now = performance.now()

    while (head !== undefined && (head.settled || head.deadline <= now)) {
      if (!head.settled) {
        head.settled = true
        head.reject(new StoreTimeoutError(timeout))
      }
      shift()
    }

    if (head === undefined) {
      tail = undefined
      timer = undefined
      return
    }

    timer = setTimeout(expire, head.deadline - now)
  }

  return function watch<Value>(promise: Promise<Value>) {
    return new Promise<Value>((resolve, reject) => {
      const pending: Pending = {
        deadline: performance.now() + timeout,
        next: undefined,
        reject,
        settled: false,
      }

      if (tail === undefined) {
        head = pending
      } else {
        tail.next = pending
      }
      tail = pending

      if (timer === undefined) {
        timer = setTimeout(expire, timeout)
      } else if (typeof timer === "object") {
        timer.ref()
      }

      // A promise settles once, so an answer after the timeout changes nothing.
      function settle() {
        pending.settled = true

        while (head?.settled) shift()

        if (head === undefined) {
          tail = undefined
          // Other runtimes return a number, which cannot unref. An idle timer fires one more time.
          if (typeof timer === "object") timer.unref()
        }
      }

      function onValue(value: Value) {
        settle()
        resolve(value)
      }

      function onError(error: unknown) {
        settle()
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- The store's own error goes on unchanged, as `StoreError.cause`.
        reject(error)
      }

      // oxlint-disable-next-line promise/catch-or-return, promise/prefer-catch -- `then` with two handlers makes one promise less than `then` and `catch`, and saving that cost is the reason for this timer. Neither handler throws.
      promise.then(onValue, onError)
    })
  }
}
