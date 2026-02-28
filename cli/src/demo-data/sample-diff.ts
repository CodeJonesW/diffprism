/**
 * Embedded demo diff — a realistic multi-file TypeScript change.
 *
 * Shows: new file (added), modified file with multiple hunks,
 * test file (triggers test detection), and includes a console.log
 * and TODO to trigger pattern flags in the briefing bar.
 */
export const sampleDiff = `diff --git a/src/middleware/auth.ts b/src/middleware/auth.ts
new file mode 100644
index 0000000..a1b2c3d
--- /dev/null
+++ b/src/middleware/auth.ts
@@ -0,0 +1,52 @@
+import jwt from "jsonwebtoken";
+import type { Request, Response, NextFunction } from "express";
+
+const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
+const TOKEN_EXPIRY = "24h";
+
+export interface AuthPayload {
+  userId: string;
+  email: string;
+  role: "admin" | "user" | "viewer";
+}
+
+/**
+ * Verify JWT token from Authorization header.
+ * Attaches decoded payload to req.auth on success.
+ */
+export function authenticate(
+  req: Request,
+  res: Response,
+  next: NextFunction,
+): void {
+  const header = req.headers.authorization;
+
+  if (!header?.startsWith("Bearer ")) {
+    res.status(401).json({ error: "Missing or invalid Authorization header" });
+    return;
+  }
+
+  const token = header.slice(7);
+
+  try {
+    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
+    (req as Request & { auth: AuthPayload }).auth = decoded;
+    next();
+  } catch (err) {
+    if (err instanceof jwt.TokenExpiredError) {
+      res.status(401).json({ error: "Token expired" });
+      return;
+    }
+    // TODO: Add refresh token support
+    console.log("Auth error:", err);
+    res.status(401).json({ error: "Invalid token" });
+  }
+}
+
+/**
+ * Generate a signed JWT for the given user payload.
+ */
+export function generateToken(payload: AuthPayload): string {
+  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
+}
diff --git a/src/routes/users.ts b/src/routes/users.ts
index d4e5f6a..b7c8d9e 100644
--- a/src/routes/users.ts
+++ b/src/routes/users.ts
@@ -1,6 +1,7 @@
 import { Router } from "express";
 import { db } from "../db/client.js";
 import { validateBody } from "../util/validate.js";
+import { authenticate, type AuthPayload } from "../middleware/auth.js";

 const router = Router();

@@ -12,6 +13,22 @@
   res.json(users);
 });

+// Protected routes — require valid JWT
+router.use(authenticate);
+
+router.get("/me", (req, res) => {
+  const auth = (req as Request & { auth: AuthPayload }).auth;
+  const user = db.users.findById(auth.userId);
+
+  if (!user) {
+    res.status(404).json({ error: "User not found" });
+    return;
+  }
+
+  const { passwordHash, ...profile } = user;
+  res.json(profile);
+});
+
 router.post("/", validateBody("createUser"), async (req, res) => {
   const { email, name, role } = req.body;

@@ -22,7 +39,7 @@
     return;
   }

-  const user = await db.users.create({ email, name, role });
+  const user = await db.users.create({ email, name, role: role ?? "user" });
   res.status(201).json(user);
 });

diff --git a/src/middleware/__tests__/auth.test.ts b/src/middleware/__tests__/auth.test.ts
new file mode 100644
index 0000000..e1f2a3b
--- /dev/null
+++ b/src/middleware/__tests__/auth.test.ts
@@ -0,0 +1,64 @@
+import { describe, it, expect, vi, beforeEach } from "vitest";
+import { authenticate, generateToken } from "../auth.js";
+
+function createMockReq(authHeader?: string) {
+  return {
+    headers: { authorization: authHeader },
+  } as unknown as Request;
+}
+
+function createMockRes() {
+  const res = {
+    status: vi.fn().mockReturnThis(),
+    json: vi.fn().mockReturnThis(),
+  };
+  return res as unknown as Response;
+}
+
+describe("authenticate middleware", () => {
+  const validPayload = { userId: "u1", email: "test@example.com", role: "user" as const };
+
+  it("rejects requests without Authorization header", () => {
+    const req = createMockReq();
+    const res = createMockRes();
+    const next = vi.fn();
+
+    authenticate(req as any, res as any, next);
+
+    expect(res.status).toHaveBeenCalledWith(401);
+    expect(next).not.toHaveBeenCalled();
+  });
+
+  it("rejects requests with invalid token", () => {
+    const req = createMockReq("Bearer invalid-token");
+    const res = createMockRes();
+    const next = vi.fn();
+
+    authenticate(req as any, res as any, next);
+
+    expect(res.status).toHaveBeenCalledWith(401);
+    expect(next).not.toHaveBeenCalled();
+  });
+
+  it("passes valid tokens and attaches auth payload", () => {
+    const token = generateToken(validPayload);
+    const req = createMockReq(\`Bearer \${token}\`);
+    const res = createMockRes();
+    const next = vi.fn();
+
+    authenticate(req as any, res as any, next);
+
+    expect(next).toHaveBeenCalled();
+    expect((req as any).auth).toMatchObject({
+      userId: "u1",
+      email: "test@example.com",
+    });
+  });
+});
+
+describe("generateToken", () => {
+  it("returns a string token", () => {
+    const token = generateToken({ userId: "u1", email: "a@b.com", role: "admin" });
+    expect(typeof token).toBe("string");
+    expect(token.split(".")).toHaveLength(3); // JWT has 3 parts
+  });
+});
`;
