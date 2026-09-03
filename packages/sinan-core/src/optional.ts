/**
 * Represents a value that may or may not be present.
 *
 * `null` and `undefined` are both treated as an absent value at the factory
 * boundary. An Optional itself is immutable; transformation methods always
 * return another Optional rather than mutating the receiver.
 */
export class Optional<T> implements Iterable<T> {
  private static readonly EMPTY: Optional<never> = new Optional<never>(undefined);

  private constructor(private readonly value: T | undefined) {}

  /** Returns the shared empty Optional instance. */
  public static empty<T>(): Optional<T> {
    return Optional.EMPTY as Optional<T>;
  }

  /**
   * Wraps a non-nullish value.
   *
   * This is the strict factory, matching Java's `Optional.of`: nullish input
   * is a programming error and is rejected immediately.
   */
  public static of<T>(value: T): Optional<NonNullable<T>> {
    if (value === null || value === undefined) {
      throw new TypeError("Optional.of() cannot be called with null or undefined");
    }
    return new Optional(value as NonNullable<T>);
  }

  /** Wraps a value, producing an empty Optional for nullish input. */
  public static ofNullable<T>(value: T | null | undefined): Optional<NonNullable<T>> {
    return value === null || value === undefined
      ? Optional.empty<NonNullable<T>>()
      : new Optional(value as NonNullable<T>);
  }

  /** Returns true when a value is present. */
  public isPresent(): boolean {
    return this.value !== undefined;
  }

  /** Returns true when no value is present. */
  public isEmpty(): boolean {
    return !this.isPresent();
  }

  /**
   * Returns the contained value.
   *
   * @throws NoSuchElementError when this Optional is empty.
   */
  public get(): T {
    if (this.value === undefined) {
      throw new NoSuchElementError();
    }
    return this.value;
  }

  /** Runs an action when a value is present. */
  public ifPresent(action: (value: T) => void): void {
    assertFunction(action, "action");
    if (this.value !== undefined) {
      action(this.value);
    }
  }

  /** Runs one of two actions depending on whether a value is present. */
  public ifPresentOrElse(
    action: (value: T) => void,
    emptyAction: () => void,
  ): void {
    assertFunction(action, "action");
    assertFunction(emptyAction, "emptyAction");
    if (this.value === undefined) {
      emptyAction();
    } else {
      action(this.value);
    }
  }

  /** Keeps the value only when the predicate accepts it. */
  public filter(predicate: (value: T) => boolean): Optional<T> {
    assertFunction(predicate, "predicate");
    if (this.value === undefined || predicate(this.value)) {
      return this;
    }
    return Optional.empty<T>();
  }

  /**
   * Transforms a present value. A nullish mapper result becomes empty, just
   * like Java Optional.map when its mapper returns null.
   */
  public map<U>(mapper: (value: T) => U | null | undefined): Optional<NonNullable<U>> {
    assertFunction(mapper, "mapper");
    return this.value === undefined
      ? Optional.empty<NonNullable<U>>()
      : Optional.ofNullable(mapper(this.value));
  }

  /** Transforms a value with a mapper that already returns an Optional. */
  public flatMap<U>(mapper: (value: T) => Optional<U>): Optional<U> {
    assertFunction(mapper, "mapper");
    if (this.value === undefined) {
      return Optional.empty<U>();
    }

    const result = mapper(this.value);
    if (!(result instanceof Optional)) {
      throw new TypeError("Optional.flatMap() mapper must return an Optional");
    }
    return result;
  }

  /** Returns this Optional when present, otherwise asks for an alternative. */
  public or(supplier: () => Optional<T>): Optional<T> {
    assertFunction(supplier, "supplier");
    if (this.value !== undefined) {
      return this;
    }

    const result = supplier();
    if (!(result instanceof Optional)) {
      throw new TypeError("Optional.or() supplier must return an Optional");
    }
    return result;
  }

  /** Returns the value, or the supplied fallback value. */
  public orElse(other: T): T {
    return this.value === undefined ? other : this.value;
  }

  /** Returns the value, or computes a fallback only when empty. */
  public orElseGet(supplier: () => T): T {
    if (this.value !== undefined) {
      return this.value;
    }
    assertFunction(supplier, "supplier");
    return supplier();
  }

  /** Returns the value, or throws the supplied exception (or a default one). */
  public orElseThrow<E extends Error = NoSuchElementError>(exceptionSupplier?: () => E): T {
    if (this.value !== undefined) {
      return this.value;
    }
    if (exceptionSupplier === undefined) {
      throw new NoSuchElementError();
    }
    assertFunction(exceptionSupplier, "exceptionSupplier");
    throw exceptionSupplier();
  }

  /** Converts this Optional to a nullable value. */
  public toNullable(): T | null {
    return this.value === undefined ? null : this.value;
  }

  /** Converts this Optional to an undefined-or-value representation. */
  public toUndefined(): T | undefined {
    return this.value;
  }

  /** Java-style value equality for Optional instances. */
  public equals(other: unknown): boolean {
    if (!(other instanceof Optional)) {
      return false;
    }
    if (this.value === undefined || other.value === undefined) {
      return this.value === undefined && other.value === undefined;
    }
    return Object.is(this.value, other.value);
  }

  /** Java-style display form: `Optional[value]` or `Optional.empty`. */
  public toString(): string {
    return this.value === undefined ? "Optional.empty" : `Optional[${String(this.value)}]`;
  }

  /** Allows a present Optional to be consumed by `for...of`. */
  public *[Symbol.iterator](): IterableIterator<T> {
    if (this.value !== undefined) {
      yield this.value;
    }
  }
}

/** Error thrown when a value is requested from an empty Optional. */
export class NoSuchElementError extends Error {
  public constructor(message = "No value present") {
    super(message);
    this.name = "NoSuchElementError";
  }
}

function assertFunction(value: unknown, name: string): void {
  if (typeof value !== "function") {
    throw new TypeError(`Optional ${name} must be a function`);
  }
}
