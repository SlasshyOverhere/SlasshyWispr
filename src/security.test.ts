import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Test escapeHtml function (will be imported from main.ts after refactoring)
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

describe("Security: HTML Escaping", () => {
  it("should escape ampersands", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("should escape less-than signs", () => {
    expect(escapeHtml("a < b")).toBe("a &lt; b");
  });

  it("should escape greater-than signs", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("should escape double quotes", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("should escape single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("should escape all dangerous characters together", () => {
    const input = '<script>alert("xss")</script>';
    const output = escapeHtml(input);
    expect(output).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(output).not.toContain("<");
    expect(output).not.toContain(">");
    expect(output).not.toContain('"');
  });

  it("should handle empty strings", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("should pass through safe text unchanged", () => {
    const safe = "Hello World 123";
    expect(escapeHtml(safe)).toBe(safe);
  });

  it("should handle unicode characters", () => {
    const unicode = "你好世界 🌍";
    expect(escapeHtml(unicode)).toBe(unicode);
  });

  it("should escape multiple occurrences of the same character", () => {
    const input = "<div><span>test</span></div>";
    const output = escapeHtml(input);
    const ltCount = (output.match(/&lt;/g) || []).length;
    expect(ltCount).toBe(4);
  });
});

describe("Security: Input Validation", () => {
  // Simulate backend validation logic
  function validateTextInput(text: string, maxLength: number, fieldName: string): { valid: boolean; error?: string; sanitized?: string } {
    if (text.length > maxLength) {
      return { valid: false, error: `${fieldName} exceeds maximum length of ${maxLength}` };
    }

    // Check for control characters
    const hasControlChars = [...text].some(c => c.charCodeAt(0) < 32 && !['\n', '\t', '\r'].includes(c));
    if (hasControlChars) {
      return { valid: false, error: `${fieldName} contains invalid control characters` };
    }

    return { valid: true, sanitized: text.trim() };
  }

  it("should accept valid text input", () => {
    const result = validateTextInput("Hello world", 1000, "test");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("Hello world");
  });

  it("should reject input exceeding max length", () => {
    const longText = "A".repeat(2001);
    const result = validateTextInput(longText, 2000, "message");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds maximum length");
  });

  it("should reject input with control characters", () => {
    const result = validateTextInput("Hello\x01World", 1000, "test");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("control characters");
  });

  it("should allow newlines and tabs", () => {
    const result = validateTextInput("Line 1\nLine 2\tTab", 1000, "test");
    expect(result.valid).toBe(true);
  });

  it("should trim whitespace", () => {
    const result = validateTextInput("  trimmed  ", 1000, "test");
    expect(result.sanitized).toBe("trimmed");
  });

  it("should handle empty input", () => {
    const result = validateTextInput("", 1000, "test");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("");
  });

  it("should enforce exact max length", () => {
    const exactLength = "A".repeat(100);
    const result = validateTextInput(exactLength, 100, "test");
    expect(result.valid).toBe(true);
  });

  it("should reject input one char over limit", () => {
    const overLimit = "A".repeat(101);
    const result = validateTextInput(overLimit, 100, "test");
    expect(result.valid).toBe(false);
  });
});

describe("Security: Base64 Validation", () => {
  function validateBase64Input(base64Str: string, maxSizeBytes: number): { valid: boolean; error?: string; decoded?: Uint8Array } {
    // Rough size check before decoding
    const estimatedSize = (base64Str.length * 3) / 4;
    if (estimatedSize > maxSizeBytes) {
      return { valid: false, error: `Base64 input too large: estimated ${Math.round(estimatedSize)} bytes (max ${maxSizeBytes})` };
    }

    try {
      // Try to decode
      const binaryString = atob(base64Str);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      if (bytes.length > maxSizeBytes) {
        return { valid: false, error: `Decoded data too large: ${bytes.length} bytes (max ${maxSizeBytes})` };
      }

      return { valid: true, decoded: bytes };
    } catch (e) {
      return { valid: false, error: `Invalid base64 encoding: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  it("should accept valid base64 within limits", () => {
    const data = "SGVsbG8sIFdvcmxkIQ=="; // "Hello, World!"
    const result = validateBase64Input(data, 1024);
    expect(result.valid).toBe(true);
    expect(result.decoded).toBeDefined();
  });

  it("should reject oversized base64", () => {
    const largeData = "A".repeat(10000);
    const result = validateBase64Input(largeData, 100);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too large");
  });

  it("should reject invalid base64", () => {
    const result = validateBase64Input("!!!invalid!!!", 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid base64");
  });

  it("should handle empty base64", () => {
    const result = validateBase64Input("", 1024);
    expect(result.valid).toBe(true);
  });

  it("should correctly decode known values", () => {
    const input = "dGVzdCBkYXRh"; // "test data"
    const result = validateBase64Input(input, 1024);
    expect(result.valid).toBe(true);
    const decoded = new TextDecoder().decode(result.decoded);
    expect(decoded).toBe("test data");
  });
});

describe("Security: Path Traversal Prevention", () => {
  function validateFilePath(filePath: string, allowedRoot: string): { valid: boolean; error?: string; normalized?: string } {
    // Normalize path separators
    const normalized = filePath.replace(/\\/g, "/");
    const normalizedRoot = allowedRoot.replace(/\\/g, "/");

    // Check if path starts with allowed root
    if (!normalized.startsWith(normalizedRoot)) {
      return { valid: false, error: `Path traversal detected: ${filePath} is not within ${allowedRoot}` };
    }

    // Check for .. sequences
    if (normalized.includes("..")) {
      return { valid: false, error: "Path contains '..' sequence which is not allowed" };
    }

    return { valid: true, normalized };
  }

  it("should accept paths within allowed directory", () => {
    const result = validateFilePath("/safe/dir/file.txt", "/safe/dir");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("/safe/dir/file.txt");
  });

  it("should reject path traversal attempts", () => {
    const result = validateFilePath("/safe/dir/../../../etc/passwd", "/safe/dir");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("'..'");
  });

  it("should reject paths outside allowed root", () => {
    const result = validateFilePath("/other/dir/file.txt", "/safe/dir");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not within");
  });

  it("should normalize backslashes", () => {
    const result = validateFilePath("\\safe\\dir\\file.txt", "/safe/dir");
    expect(result.valid).toBe(true);
  });

  it("should reject absolute paths outside root", () => {
    const result = validateFilePath("C:\\Windows\\System32\\cmd.exe", "/safe/dir");
    expect(result.valid).toBe(false);
  });
});

describe("Security: Hotkey Validation", () => {
  function validateHotkey(hotkey: string): { valid: boolean; error?: string } {
    const parts = hotkey.split("+").map(p => p.trim());

    const validModifiers = new Set(["Ctrl", "Shift", "Alt", "Meta"]);
    const validKeys = new Set([
      "Space", "Enter", "Escape", "Tab", "Backspace", "Delete",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
      "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
      "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
      "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"
    ]);

    if (parts.length === 0 || parts.length > 4) {
      return { valid: false, error: "Hotkey must have 1-4 components" };
    }

    // All but last must be modifiers
    for (let i = 0; i < parts.length - 1; i++) {
      if (!validModifiers.has(parts[i])) {
        return { valid: false, error: `Invalid modifier: ${parts[i]}` };
      }
    }

    // Last must be a valid key
    if (!validKeys.has(parts[parts.length - 1])) {
      return { valid: false, error: `Invalid key: ${parts[parts.length - 1]}` };
    }

    return { valid: true };
  }

  it("should accept valid hotkeys", () => {
    expect(validateHotkey("Ctrl+Space").valid).toBe(true);
    expect(validateHotkey("Ctrl+Shift+A").valid).toBe(true);
    expect(validateHotkey("Alt+F4").valid).toBe(true);
  });

  it("should reject hotkeys with invalid modifiers", () => {
    const result = validateHotkey("Invalid+Space");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid modifier");
  });

  it("should reject hotkeys with invalid keys", () => {
    const result = validateHotkey("Ctrl+@");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid key");
  });

  it("should reject hotkeys without a key", () => {
    const result = validateHotkey("Ctrl+Shift+");
    expect(result.valid).toBe(false);
  });

  it("should reject overly long hotkeys", () => {
    const result = validateHotkey("Ctrl+Shift+Alt+Meta+A");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must have 1-4 components");
  });
});

describe("Security: API Response Sanitization", () => {
  function sanitizeApiResponse(response: any): any {
    // Remove sensitive fields that should never be in responses
    const sanitized = { ...response };
    delete sanitized.apiKey;
    delete sanitized.secretKey;
    delete sanitized.password;
    delete sanitized.token;

    // Sanitize strings
    if (sanitized.message) {
      sanitized.message = escapeHtml(String(sanitized.message).substring(0, 500));
    }

    return sanitized;
  }

  it("should remove sensitive fields", () => {
    const response = {
      success: true,
      message: "Operation completed",
      apiKey: "secret-key-123",
      userId: "user-456"
    };

    const sanitized = sanitizeApiResponse(response);
    expect(sanitized.apiKey).toBeUndefined();
    expect(sanitized.success).toBe(true);
    expect(sanitized.userId).toBe("user-456");
  });

  it("should escape HTML in messages", () => {
    const response = {
      success: true,
      message: '<script>alert("xss")</script>'
    };

    const sanitized = sanitizeApiResponse(response);
    expect(sanitized.message).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  it("should truncate long messages", () => {
    const longMessage = "A".repeat(600);
    const response = { message: longMessage };
    const sanitized = sanitizeApiResponse(response);
    expect(sanitized.message.length).toBeLessThanOrEqual(500);
  });
});

describe("Security: Rate Limiting Simulation", () => {
  class RateLimiter {
    private requests: Map<string, number[]> = new Map();

    constructor(private maxRequests: number, private windowMs: number) {}

    isAllowed(key: string): boolean {
      const now = Date.now();
      const timestamps = this.requests.get(key) || [];

      // Remove old timestamps outside the window
      const valid = timestamps.filter(ts => now - ts < this.windowMs);

      if (valid.length >= this.maxRequests) {
        return false;
      }

      valid.push(now);
      this.requests.set(key, valid);
      return true;
    }
  }

  it("should allow requests within rate limit", () => {
    const limiter = new RateLimiter(5, 60000); // 5 requests per minute

    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed("user1")).toBe(true);
    }

    expect(limiter.isAllowed("user1")).toBe(false);
  });

  it("should reset after time window", () => {
    const limiter = new RateLimiter(2, 100); // 2 requests per 100ms

    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(false);

    // Wait for window to expire
    setTimeout(() => {
      expect(limiter.isAllowed("user1")).toBe(true);
    }, 150);
  });

  it("should track different users independently", () => {
    const limiter = new RateLimiter(1, 60000);

    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(false);
    expect(limiter.isAllowed("user2")).toBe(true); // Different user
  });
});
