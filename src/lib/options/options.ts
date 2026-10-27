export class InvalidOptionError extends Error {
  override readonly name = "InvalidOptionError"
  readonly option: string
  readonly value: unknown

  constructor(option: string, value: unknown, expected: string) {
    super(`Expected ${option} to be ${expected}, received ${String(value)}`)
    this.option = option
    this.value = value
  }
}

export function positiveInteger(option: string, value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidOptionError(option, value, "a positive integer")
  }

  return value
}

// Header values quote names, so a name must be printable ASCII.
export function printable(option: string, value: string) {
  if (!/^[ -~]+$/u.test(value)) {
    throw new InvalidOptionError(option, value, "a non-empty string of printable ASCII characters")
  }

  return value
}
