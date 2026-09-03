/**
 * Represents a value that may or may not be present.
 *
 * `null` and `undefined` are both treated as an absent value at the factory
 * boundary. An Optional itself is immutable; transformation methods always
 * return another Optional rather than mutating the receiver.
 *
 * @example
 * ```ts
 * const displayName = Optional.ofNullable(user.name)
 *   .map((name) => name.trim())
 *   .filter((name) => name.length > 0)
 *   .orElse("Anonymous");
 * ```
 */
export class Optional<T> implements Iterable<T> {
  private static readonly EMPTY: Optional<never> = new Optional<never>(undefined);

  private constructor(private readonly value: T | undefined) {}

  /**
   * Returns the shared empty Optional instance.
   *
   * @example `const missing = Optional.empty<string>();`
   */
  public static empty<T>(): Optional<T> {
    return Optional.EMPTY as Optional<T>;
  }

  /**
   * Wraps a non-nullish value.
   *
   * This is the strict factory, matching Java's `Optional.of`: nullish input
   * is a programming error and is rejected immediately.
   *
   * @param value The non-nullish value to wrap.
   * @returns An Optional containing `value`.
   * @throws TypeError If `value` is `null` or `undefined`.
   * @example `const answer = Optional.of(42);`
   */
  public static of<T>(value: T): Optional<NonNullable<T>> {
    if (value === null || value === undefined) {
      throw new TypeError("Optional.of() cannot be called with null or undefined");
    }
    return new Optional(value as NonNullable<T>);
  }

  /**
   * Wraps a value, producing an empty Optional for nullish input.
   *
   * @param value The value to wrap.
   * @returns An Optional containing the value, or an empty Optional.
   * @example `const value = Optional.ofNullable(config.timeoutMs);`
   */
  public static ofNullable<T>(value: T | null | undefined): Optional<NonNullable<T>> {
    return value === null || value === undefined
      ? Optional.empty<NonNullable<T>>()
      : new Optional(value as NonNullable<T>);
  }

  /**
   * Returns true when a value is present.
   *
   * @example `if (result.isPresent()) console.log(result.get());`
   */
  public isPresent(): boolean {
    return this.value !== undefined;
  }

  /**
   * Returns true when no value is present.
   *
   * @example `if (result.isEmpty()) showNotFound();`
   */
  public isEmpty(): boolean {
    return !this.isPresent();
  }

  /**
   * Returns the contained value.
   *
   * @throws NoSuchElementError when this Optional is empty.
   * @example `const value = result.get();`
   */
  public get(): T {
    if (this.value === undefined) {
      throw new NoSuchElementError();
    }
    return this.value;
  }

  /**
   * Runs an action when a value is present.
   *
   * @param action Callback receiving the contained value.
   * @example `result.ifPresent((value) => cache.set("result", value));`
   */
  public ifPresent(action: (value: T) => void): void {
    assertFunction(action, "action");
    if (this.value !== undefined) {
      action(this.value);
    }
  }

  /**
   * Runs one of two actions depending on whether a value is present.
   *
   * @param action Callback receiving the contained value.
   * @param emptyAction Callback invoked when no value is present.
   * @example
   * ```ts
   * result.ifPresentOrElse(render, () => renderEmptyState());
   * ```
   */
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

  /**
   * Keeps the value only when the predicate accepts it.
   *
   * @param predicate Test applied to a present value.
   * @returns This Optional when accepted or empty; an empty Optional stays empty.
   * @example `const adult = age.filter((value) => value >= 18);`
   */
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
   *
   * @param mapper Transformation applied only to a present value.
   * @returns An Optional containing the transformed value, or empty.
   * @example `const length = name.map((value) => value.length);`
   */
  public map<U>(mapper: (value: T) => U | null | undefined): Optional<NonNullable<U>> {
    assertFunction(mapper, "mapper");
    return this.value === undefined
      ? Optional.empty<NonNullable<U>>()
      : Optional.ofNullable(mapper(this.value));
  }

  /**
   * Transforms a value with a mapper that already returns an Optional.
   *
   * @param mapper Transformation returning the next Optional.
   * @returns The mapper result, or empty when this Optional is empty.
   * @throws TypeError If the mapper returns a non-Optional value.
   * @example `const city = user.flatMap((value) => findCity(value.cityId));`
   */
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

  /**
   * Returns this Optional when present, otherwise asks for an alternative.
   *
   * @param supplier Lazy supplier of an alternative Optional.
   * @returns This Optional when present, otherwise the supplied Optional.
   * @throws TypeError If the supplier returns a non-Optional value.
   * @example `const configured = env.or(() => Optional.of("development"));`
   */
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

  /**
   * Returns the value, or the supplied fallback value.
   *
   * @param other Fallback returned when this Optional is empty.
   * @example `const port = configuredPort.orElse(3000);`
   */
  public orElse(other: T): T {
    return this.value === undefined ? other : this.value;
  }

  /**
   * Returns the value, or computes a fallback only when empty.
   *
   * @param supplier Lazy fallback supplier.
   * @example `const token = tokenOption.orElseGet(() => createToken());`
   */
  public orElseGet(supplier: () => T): T {
    if (this.value !== undefined) {
      return this.value;
    }
    assertFunction(supplier, "supplier");
    return supplier();
  }

  /**
   * Returns the value, or throws the supplied exception (or a default one).
   *
   * @param exceptionSupplier Lazy supplier for the exception to throw.
   * @throws NoSuchElementError When empty and no supplier is provided.
   * @throws Error The exception returned by `exceptionSupplier` when empty.
   * @example `const actor = actorOption.orElseThrow(() => new Error("Actor not found"));`
   */
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

  /**
   * Converts this Optional to a nullable value.
   *
   * @returns The contained value, or `null` when empty.
   * @example `const nullableId = idOption.toNullable();`
   */
  public toNullable(): T | null {
    return this.value === undefined ? null : this.value;
  }

  /**
   * Converts this Optional to an undefined-or-value representation.
   *
   * @returns The contained value, or `undefined` when empty.
   * @example `const maybeId = idOption.toUndefined();`
   */
  public toUndefined(): T | undefined {
    return this.value;
  }

  /**
   * Compares two Optional instances by presence and `Object.is` value equality.
   *
   * @param other Value to compare with.
   * @returns `true` when both Optionals are empty or contain equal values.
   * @example `if (previous.equals(current)) return;`
   */
  public equals(other: unknown): boolean {
    if (!(other instanceof Optional)) {
      return false;
    }
    if (this.value === undefined || other.value === undefined) {
      return this.value === undefined && other.value === undefined;
    }
    return Object.is(this.value, other.value);
  }

  /**
   * Returns a Java-style display form: `Optional[value]` or `Optional.empty`.
   *
   * @returns A stable diagnostic string.
   * @example `logger.debug(result.toString());`
   */
  public toString(): string {
    return this.value === undefined ? "Optional.empty" : `Optional[${String(this.value)}]`;
  }

  /**
   * Allows a present Optional to be consumed by `for...of`.
   *
   * @returns An iterator yielding zero or one value.
   * @example `for (const value of result) render(value);`
   */
  public *[Symbol.iterator](): IterableIterator<T> {
    if (this.value !== undefined) {
      yield this.value;
    }
  }
}

/** Error thrown when a value is requested from an empty Optional. */
export class NoSuchElementError extends Error {
  /** Creates an error with a custom or default message. */
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
