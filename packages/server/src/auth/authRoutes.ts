import { Router } from 'express';
import type { AuthService } from './AuthService.js';

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    if (!isCredentialsBody(req.body)) {
      res.status(400).json({ success: false, error: '用户名和密码格式不正确' });
      return;
    }
    try {
      const result = await authService.register(req.body);
      res.status(result.success ? 200 : 400).json(result);
    } catch {
      res.status(500).json({ success: false, error: '认证服务暂时不可用' });
    }
  });

  router.post('/login', async (req, res) => {
    if (!isCredentialsBody(req.body)) {
      res.status(400).json({ success: false, error: '用户名和密码格式不正确' });
      return;
    }
    try {
      const result = await authService.login(req.body);
      res.status(result.success ? 200 : 401).json(result);
    } catch {
      res.status(500).json({ success: false, error: '认证服务暂时不可用' });
    }
  });

  router.post('/guest', async (_req, res) => {
    try {
      const result = await authService.createGuestAccount();
      res.status(200).json(result);
    } catch {
      res.status(500).json({ success: false, error: '认证服务暂时不可用' });
    }
  });

  return router;
}

function isCredentialsBody(body: unknown): body is { username: string; password: string } {
  if (typeof body !== 'object' || body === null) return false;
  const credentials = body as Record<string, unknown>;
  return typeof credentials.username === 'string' && typeof credentials.password === 'string';
}
