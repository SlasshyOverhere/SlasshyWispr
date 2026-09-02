// Polyfill localStorage for Bun test environment (not available by default in bun test)
// This must be a preload script so it runs before any module imports.

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

if (typeof globalThis.localStorage === "undefined") {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.document === "undefined") {
  Object.defineProperty(globalThis, "document", {
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: {
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {},
          contains: () => false,
        },
      },
    },
    writable: true,
    configurable: true,
  });
}

// Ensure CustomEvent is available
if (typeof globalThis.CustomEvent === "undefined") {
  (globalThis as any).CustomEvent = class CustomEvent<T = unknown> extends Event {
    detail: T;
    constructor(type: string, options?: CustomEventInit<T>) {
      super(type, options);
      this.detail = options?.detail as T;
    }
  };
}

// Ensure Event is available
if (typeof globalThis.Event === "undefined") {
  (globalThis as any).Event = class Event {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
    stopPropagation() {}
    preventDefault() {}
  };
}
